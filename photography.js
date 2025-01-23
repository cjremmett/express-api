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

async function processFileForReloadingTables(path)
{
    try
    {
        // Check if the file is JSON
        if(path.substring(path.length - 5))
        {
            let metadata = JSON.parse(await readFile(path, "utf8"));
            appendToLog('PHOTOGRAPHY', 'DEBUG', 'Writing metadata into photos collection:\n\n' + metadata);

            const client = new MongoClient(uri);
            const photographyDatabase = client.db("photography");
            const photographyCollection = photographyDatabase.collection("photos");
            const query = { id: metadata['id'] };
            const update = { $set: metadata};
            const options = { upsert: true };
            photographyCollection.updateOne(query, update, options);
        }
    }
    catch(err) 
    {
        appendToLog('PHOTOGRAPHY', 'ERROR', 'Exception thrown in processFileForReloadingTables: ' + err.message);
    }
    finally
    {
        try
        {
            await client.close();
        }
        catch(err)
        {
            appendToLog('PHOTOGRAPHY', 'ERROR', 'Exception thrown in processFileForReloadingTables when trying to close the connection: ' + err.message);
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
                processFileForReloadingTables(fullPath);
            }
            else if(stat.isDirectory())
            {
                processFolderForReloadingTables(fullPath);
            }
        }
    }
    catch(err) 
    {
        appendToLog('PHOTOGRAPHY', 'ERROR', 'Exception thrown in processFolderForReloadingTables: ' + err.message);
    }
}

photographyRouter.put('/reload-tables', async (req, res) => {
    
    try
    {
        appendToLog('PHOTOGRAPHY', 'TRACE', 'Triggered reload for MongoDB photography tables.');

        // Clear the photos and tags collections
        const client = new MongoClient(uri);
        const admin = client.db().admin();
        const dbInfo = await admin.listDatabases();
        for(const db of dbInfo.databases)
        {
            if(db.name === 'photography')
            {
                client.db(db.name).collection('photos').remove();
                client.db(db.name).collection('tags').remove();
            }
        }

        // Create photography database and photos and tags collections
        const photographyDatabase = client.db("photography");
        photographyDatabase.createCollection("photos");
        photographyDatabase.createCollection("tags");

        await processFolderForReloadingTables(photographyDirectory);
        res.status(201);
        res.send();
    }
    catch(err)
    {
        appendToLog('PHOTOGRAPHY', 'ERROR', 'Exception thrown while reloading photography tables: ' + err.message);
        res.status(500);
        res.send();
    }
    finally
    {
        try
        {
            await client.close();
        }
        catch(err)
        {
            appendToLog('PHOTOGRAPHY', 'ERROR', 'Exception thrown in reload-tables when trying to close the connection: ' + err.message);
        }
    }
});

export { photographyRouter };

