import express from 'express';
const photographyRouter = express.Router();

import { appendToLog } from './utils.js';

import { readFile } from 'fs/promises';
import * as fs from 'fs';
import * as path from 'path';

import { MongoClient } from "mongodb";

// Not port forwarded so creds can be in GitHub repo without issue
const uri = "mongodb://admin:admin@192.168.0.121:27017";
const photographyDirectory = "/srv/http/photography";

let tags = {};

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

async function getMongoQueryFromUserTagQuery(tagQuery)
{
    // If there are no tags submitted, return an empty query, which causes MongoDB to return all records in the collection.
    if(tagQuery == null || tagQuery === '')
    {
        return {};
    }

    // For whatever reason, express turns '+' symbols into ' ' when getting the query
    // The endpoint should be called with a query like ?tags=hello+world, which comes out as hello world
    let userRequestedTags = tagQuery.split(' ');

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

        let query = await getMongoQueryFromUserTagQuery(tagQuery);
        
        const client = new MongoClient(uri);
        const photographyDatabase = client.db("photography");
        const photographyCollection = photographyDatabase.collection("photos");
        let photos = await photographyCollection.find(query).toArray();
        //delete tags['_id'];
        await client.close();

        appendToLog('PHOTOGRAPHY', 'TRACE', JSON.stringify(query));
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


export { photographyRouter };

