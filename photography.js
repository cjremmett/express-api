import express from 'express';
const photographyRouter = express.Router();

import { appendToLog } from './utils.js';

import { readFile } from 'fs/promises';
import * as fs from 'fs';
import * as path from 'path';

import { MongoClient, ServerApiVersion } from "mongodb";
const uri = "mongodb://localhost:27017";
const client = new MongoClient(uri,  
{
    serverApi: 
    {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

const photographyDirectory = "/srv/http/photography";

async function processFileForReloadingTables(path)
{
    try
    {
        // Check if the file is JSON
        if(path.substring(path.length - 5))
        {
            let metadata = JSON.parse(await readFile(path, "utf8"));
    
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
        await client.close();
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
        await processFolderForReloadingTables(photographyDirectory);
        res.status(201);
        res.send();
    }
    catch(err)
    {
        res.status(500);
        res.send();
    }
});

export { photographyRouter };

