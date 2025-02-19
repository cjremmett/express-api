import express from 'express';
const photographyRouter = express.Router();

import { appendToLog } from './utils.js';

import { readFile } from 'fs/promises';
import * as fs from 'fs';
import * as path from 'path';

import { MongoClient } from "mongodb";

import { ExifImage } from 'exif';

// Not port forwarded so creds can be in GitHub repo without issue
const uri = "mongodb://admin:admin@192.168.0.121:27017";
const photographyDirectory = "/srv/http/images/photography";

let tags = {};

async function populateMetadataTagsForPhoto(metadataJson)
{
    try
    {
        let imageFullPath = photographyDirectory + '/' + metadataJson['id'] + '/' + metadataJson['raw'];
        appendToLog('PHOTOGRAPHY', 'TRACE', 'Attempting to extract EXIF data from image file located at: ' + imageFullPath);
        new ExifImage({ image : imageFullPath }, function (error, exifData) {
            if (error)
            {
                appendToLog('PHOTOGRAPHY', 'ERROR', 'Exception thrown extracting EXIF data from image file located at: ' + imageFullPath + '\nError message: ' + error.message);
            }
            else
            {
                appendToLog('PHOTOGRAPHY', 'TRACE', 'ExifData: ' + JSON.stringify(exifData));
            }
        });
    }
    catch (error)
    {
        appendToLog('PHOTOGRAPHY', 'ERROR', 'Exception thrown in populateMetadataTagsForPhoto: ' + error.message);
    }
}

async function processFileForReloadingTables(path)
{
    // Check if the file is JSON
    if(path.length > 5 && path.substring(path.length - 5).toUpperCase() === '.JSON')
    {
        try
        {
            let metadata = JSON.parse(await readFile(path, "utf8"));

            // Update the tags JSON
            for(const tag of Object.keys(metadata['tags']))
            {
                tags[tag] = true;
            }

            await populateMetadataTagsForPhoto(metadata);
    
            const client = new MongoClient(uri);
            const photographyDatabase = client.db("photography");
            const photographyCollection = photographyDatabase.collection("photos");
            const query = { id: metadata['id'] };
            const update = { $set: metadata};
            const options = { upsert: true };
            await photographyCollection.updateOne(query, update, options);
            await client.close();
            appendToLog('PHOTOGRAPHY', 'TRACE', 'Upserted photo with id ' + metadata['id'] + '.');
        }
        catch(err) 
        {
            appendToLog('PHOTOGRAPHY', 'ERROR', 'Exception thrown in processFileForReloadingTables: ' + err.message);
        }
    }
}

async function processFolderForReloadingTables(directory)
{
    // Recursively descends into subdirectories and processes each metadata file found
    try 
    {
        // Get the files as an array
        const files = await fs.promises.readdir(directory);

        // Loop over each file or folder in the directory
        for(const file of files)
        {
            // Get the object full path
            const fullPath = path.join(directory, file);

            // Stat the file to see if we have a file or dir
            const stat = await fs.promises.stat(fullPath);

            if(stat.isFile())
            {
                await processFileForReloadingTables(fullPath);
            }
            else if(stat.isDirectory())
            {
                await processFolderForReloadingTables(fullPath);
            }
        }
    }
    catch(err) 
    {
        appendToLog('PHOTOGRAPHY', 'ERROR', 'Exception thrown in processFolderForReloadingTables: ' + err.message);
    }
}

async function updateTagsForReloadingTables()
{
    try
    {
        const client = new MongoClient(uri);
        const photographyDatabase = client.db("photography");
        const tagsCollection = photographyDatabase.collection("tags");
        await tagsCollection.insertOne(tags);
        await client.close();
        appendToLog('PHOTOGRAPHY', 'TRACE', 'Inserted tags: ' + JSON.stringify(tags));
    }
    catch(err) 
    {
        appendToLog('PHOTOGRAPHY', 'ERROR', 'Exception thrown in updateTagsForReloadingTables: ' + err.message);
    }
}

photographyRouter.put('/reload-tables', async (req, res) => {
    
    try
    {
        appendToLog('PHOTOGRAPHY', 'TRACE', 'Triggered reload for MongoDB photography tables.');

        // Clear the photos and tags collections
        let client = new MongoClient(uri);
        let admin = client.db().admin();
        let dbInfo = await admin.listDatabases();
        for(let db of dbInfo.databases)
        {
            if(db.name === 'photography')
            {
                await client.db(db.name).collection('photos').drop();
                await client.db(db.name).collection('tags').drop();
            }
        }

        // Create photography database and photos and tags collections
        let photographyDatabase = client.db("photography");
        await photographyDatabase.createCollection("photos");
        await photographyDatabase.createCollection("tags");

        await client.close();

        await processFolderForReloadingTables(photographyDirectory);
        await updateTagsForReloadingTables();
        tags = {};
        res.status(201);
        res.send();
    }
    catch(err)
    {
        appendToLog('PHOTOGRAPHY', 'ERROR', 'Exception thrown while reloading photography tables: ' + err.message);
        res.status(500);
        res.send();
    }
});

photographyRouter.get('/get-all-tags', async (req, res) => {
    
    try
    {
        appendToLog('PHOTOGRAPHY', 'TRACE', 'User at ' + req.ip + ' requested all tags.');

        const client = new MongoClient(uri);
        const photographyDatabase = client.db("photography");
        const photographyCollection = photographyDatabase.collection("tags");
        let tags = await photographyCollection.findOne();
        delete tags['_id'];
        await client.close();

        res.json(tags);
        res.status(200);
        res.send();
    }
    catch(err)
    {
        appendToLog('PHOTOGRAPHY', 'ERROR', 'Exception thrown getting all tags: ' + err.message);
        res.status(500);
        res.send();
    }
});

function getMongoQueryFromUserTagQuery(tagQuery)
{
    // If there are no tags submitted, return an empty query, which causes MongoDB to return all records in the collection.
    if(tagQuery == null || tagQuery === '')
    {
        return {};
    }

    // For whatever reason, express turns '+' symbols into ' ' when getting the query
    // The endpoint should be called with a query like ?tags=hello+world, which comes out as hello world
    let userRequestedTags = tagQuery.trim().split(' ');

    let query = {};
    for(const tag of userRequestedTags)
    {
        let tagKey = 'tags.' + tag;
        query[tagKey] = true;
    }
    
    return query;
}

photographyRouter.get('/get-photos', async (req, res) => {
    
    try
    {
        let tagQuery = req.query.tags;
        appendToLog('PHOTOGRAPHY', 'TRACE', 'User at ' + req.ip + ' requested photos with tags: ' + tagQuery);

        let query = getMongoQueryFromUserTagQuery(tagQuery);
        
        const client = new MongoClient(uri);
        const photographyDatabase = client.db("photography");
        const photographyCollection = photographyDatabase.collection("photos");
        let photos = await photographyCollection.find(query).project({ _id: 0, id: 1, big_thumb: 1, small_thumb: 1 }).toArray();
        await client.close();

        res.json(photos);
        res.status(200);
        res.send();
    }
    catch(err)
    {
        appendToLog('PHOTOGRAPHY', 'ERROR', 'Exception thrown getting photos: ' + err.message);
        res.status(500);
        res.send();
    }
});

function getMongoQueryFromUserPhotoId(photoId)
{
    let query = { 'id': photoId };
    return query;
}

photographyRouter.get('/get-photo-data/:photoId', async (req, res) => {
    
    try
    {
        let photoId = req.params['photoId'];
        appendToLog('PHOTOGRAPHY', 'TRACE', 'User at ' + req.ip + ' requested full data for photo with ID ' + photoId + '.');

        let query = getMongoQueryFromUserPhotoId(photoId);
        
        const client = new MongoClient(uri);
        const photographyDatabase = client.db("photography");
        const photographyCollection = photographyDatabase.collection("photos");
        let photoData = await photographyCollection.find(query).project({ _id: 0, id: 1, camera: 1, fNumber: 1, focalLength: 1, full: 1, iso:1, lens: 1, raw: 1, shutterSpeed: 1, uploadTimestamp: 1 }).toArray();
        await client.close();

        res.json(photoData);
        res.status(200);
        res.send();
    }
    catch(err)
    {
        appendToLog('PHOTOGRAPHY', 'ERROR', 'Exception thrown getting photo data: ' + err.message);
        res.status(500);
        res.send();
    }
});


export { photographyRouter };

