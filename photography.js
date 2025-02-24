import express from 'express';
const photographyRouter = express.Router();

// Not port forwarded so creds can be in GitHub repo without issue
const uri = "mongodb://admin:admin@192.168.0.121:27017";
const photographyDirectory = "/srv/http/images/photography";

import multer from 'multer';
const storage = multer.diskStorage({ 
    destination: function (req, file, cb) {
        cb(null, photographyDirectory)
    },
    filename: function (req, file, cb) {
        cb(null, file.originalname)
    }
});
const upload = multer({ storage: storage });

import { appendToLog } from './utils.js';
import { getSecretsJson } from './redistools.js';
import { exiftool } from "exiftool-vendored";

import { readFile } from 'fs/promises';
import * as fs from 'fs';
import * as path from 'path';

import { v4 as uuidv4 } from 'uuid';

import { MongoClient } from "mongodb";



let tags = {};

// Creates a new UUID photo folder and puts a metadata file in it
async function createNewFolderWithMetadata(tags)
{
    try
    {
        let uuid = uuidv4(); // ⇨ '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d'
        const newDirectory = photographyDirectory + '/' + uuid;
        
        await fs.promises.mkdir(newDirectory);
        await fs.promises.chown(newDirectory, 1000, 1000, (error) => {
            if (error)
            {
                appendToLog('PHOTOGRAPHY', 'ERROR', 'Failed to chown new folder at ' + newDirectory + '\nError message: ' + error.message);
            }
        }); 

        let metadataJson = {};
        metadataJson['tags'] = tags;
        metadataJson['id'] = uuid;
        metadataJson['uploadTimestamp'] = Math.floor(Date.now());

        const metadataFilePath = newDirectory + '/metadata.json';
        fs.writeFile(metadataFilePath, JSON.stringify(metadataJson), (err) => {
            if (err)
            {
                appendToLog('PHOTOGRAPHY', 'ERROR', 'Failed to create metadata file at ' + metadataFilePath + '\nError message: ' + err.message);
            }
            else 
            {
                appendToLog('PHOTOGRAPHY', 'INFO', 'Created new metadata file at ' + metadataFilePath);
            }
        });

        return uuid;
    }
    catch (err) 
    {
        console.error(err);
    }
}

// Create a new UUID photo folder and send the ID back to the client so they can proceed to upload photos
photographyRouter.post('/create-photo', async (req, res) => {
    try
    {
        let authToken = req.header('token');
        let secrets = await getSecretsJson();
        if(authToken === secrets['secrets']['photography_tools']['api_token'])
        {
            // Pass something formatted like { "wildlife": true, "bird": true}
            let tags = req.body;
            appendToLog('PHOTOGRAPHY', 'TRACE', 'User at ' + req.ip + ' submitted a new photo request with tags: ' + JSON.stringify(tags));

            let uuid = await createNewFolderWithMetadata(tags);
            res.json({ "uuid": uuid});
            res.status(201);
            res.send();
        }
        else
        {
            res.status(401);
            res.send();
        }
    }
    catch(err)
    {
        appendToLog('PHOTOGRAPHY', 'ERROR', 'Exception thrown getting photos: ' + err.message);
        res.status(500);
        res.send();
    }
});

photographyRouter.put('/upload-photos/:photoId', upload.array("photos"), uploadPhotos);

// For each file, copy it into the UUID photo folder based on the parameter.
// The file names must be raw, full, big_thumb, small_thumb.
// This is so we can identify which type of photo it is and update the metadata accordingly.
async function uploadPhotos(req, res)
{
    try
    {
        let authToken = req.header('token');
        let secrets = await getSecretsJson();
        if(authToken === secrets['secrets']['photography_tools']['api_token'])
        {
            let photoId = req.params['photoId'];
            for(const photoFile of req.files)
            {
                let uploadTempFileLocation = photographyDirectory + '/' + photoFile.originalname;
                let finalDestinationLocation = photographyDirectory + '/' + photoId + '/' + photoFile.originalname;
                await fs.promises.rename(uploadTempFileLocation, finalDestinationLocation, async function (err) {
                    if (err)
                    {
                        await appendToLog('PHOTOGRAPHY', 'ERROR', 'Failed to move a photo from the temp directory to the photo folder.\nError message: ' + err.message);
                    }
                    else
                    {
                        await appendToLog('PHOTOGRAPHY', 'TRACE', 'Wrote uploaded photo to ' + finalDestinationLocation);
                    }
                });
                await fs.promises.chown(finalDestinationLocation, 1000, 1000, async function (err) {
                    if (err)
                    {
                        await appendToLog('PHOTOGRAPHY', 'ERROR', 'Failed to chown image at ' + finalDestinationLocation + '\nError message: ' + err.message);
                    }
                });

                let metadataLocation = photographyDirectory + '/' + photoId + '/metadata.json';
                let metadata = JSON.parse(await readFile(metadataLocation, "utf8"));
                metadata[(photoFile.originalname).split('.')[0]] = photoFile.originalname;
                fs.writeFile(metadataLocation, JSON.stringify(metadata), async function(err) {
                    if (err)
                    {
                        await appendToLog('PHOTOGRAPHY', 'ERROR', 'Failed to write to file at ' + metadataLocation + '\nError message: ' + err.message);
                    }
                    else
                    {
                        await appendToLog('PHOTOGRAPHY', 'INFO', 'Wrote out metadata information to ' + metadataLocation);
                    }
                });
            }
            
            res.status(201);
            res.send();
        }
        else
        {
            // Multer uploads the files to the server when the endpoint is called, even if authentication fails
            // We need to remove the files if authentication fails
            for(const photoFile of req.files)
            {
                let uploadTempFileLocation = photographyDirectory + '/' + photoFile.originalname;
                let err = await fs.promises.unlink(uploadTempFileLocation);
                if (err)
                {
                    await appendToLog('PHOTOGRAPHY', 'ERROR', 'Failed to remove a file uploaded by an unauthorized user.\nError message: ' + err.message);
                }
                else
                {
                    await appendToLog('PHOTOGRAPHY', 'WARNING', 'Removed a file uploaded by an unauthenticated user at: ' + uploadTempFileLocation);
                }
            }

            res.status(401);
            res.send();
        }
    }
    catch(err)
    {
        appendToLog('PHOTOGRAPHY', 'ERROR', 'Exception thrown uploading photos: ' + err.message);
        res.status(500);
        res.send();
    }
}

async function getExifDataForPhoto(metadataJson)
{
    try 
    {
        let imageFullPath = photographyDirectory + '/' + metadataJson['id'] + '/' + metadataJson['raw'];

        appendToLog('PHOTOGRAPHY', 'INFO', 'Extracting EXIF data from image file located at: ' + imageFullPath);
        try
        {
            const exifData = await exiftool.read(imageFullPath);
            return exifData;
        }
        finally
        {
            // Apparently we don't need this - docs are unclear what the implications of never calling it are.
            // await exiftool.end();
        }
    }
    catch(err) 
    {
        appendToLog('PHOTOGRAPHY', 'ERROR', 'Exception thrown in getExifDataForPhoto: ' + err.message);
    } 
}

async function populateMetadataJsonWithExifFields(metadataJson)
{
    try 
    {
        // Pulls the EXIF data from the raw file in the metadata
        let exifData = await getExifDataForPhoto(metadataJson);

        metadataJson['camera'] = exifData['Make'] + ' ' + exifData['Model'];
        metadataJson['lens'] = exifData['LensSpec'];
        metadataJson['focalLength'] = exifData['FocalLength'].split('.')[0] + ' mm';
        metadataJson['fNumber'] = 'f/' + exifData['FNumber'];
        metadataJson['shutterSpeed'] = exifData['ShutterSpeed'];
        metadataJson['iso'] = exifData['ISO'];
        return metadataJson;
    }
    catch(err) 
    {
        appendToLog('PHOTOGRAPHY', 'ERROR', 'Exception thrown in populateMetadataJsonWithExifFields: ' + err.message);
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

            await populateMetadataJsonWithExifFields(metadata);
            fs.writeFile(path, JSON.stringify(metadata), async function(err) {
                if (err)
                {
                    await appendToLog('PHOTOGRAPHY', 'ERROR', 'Failed to write to file at ' + path + '\nError message: ' + err.message);
                }
                else 
                {
                    await appendToLog('PHOTOGRAPHY', 'INFO', 'Wrote out metadata information to ' + path);
                }
            });
    
            const client = new MongoClient(uri);
            const photographyDatabase = client.db("photography");
            const photographyCollection = photographyDatabase.collection("photos");
            const query = { id: metadata['id'] };
            const update = { $set: metadata};
            const options = { upsert: true };
            await photographyCollection.updateOne(query, update, options);
            await client.close();
            appendToLog('PHOTOGRAPHY', 'INFO', 'Upserted photo with id ' + metadata['id'] + '.');
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
        appendToLog('PHOTOGRAPHY', 'INFO', 'Inserted tags: ' + JSON.stringify(tags));
    }
    catch(err) 
    {
        appendToLog('PHOTOGRAPHY', 'ERROR', 'Exception thrown in updateTagsForReloadingTables: ' + err.message);
    }
}

photographyRouter.put('/reload-tables', async (req, res) => {
    
    try
    {
        appendToLog('PHOTOGRAPHY', 'INFO', 'Triggered reload for MongoDB photography tables.');

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

