const express = require('express');
const router = express.Router();

const redis = require('./redistools');
const pgp = require('pg-promise')(/* options */);
let db = getPostgresConnectionObject();


async function isAuthorized(req)
{
    try
    {
        const authHeader = req.headers.authorization;
 
        if (!authHeader)
        {
            appendToLog('MAIN', 'ERROR', 'Request was made to ' + req.originalUrl + ' without an authorization header.');
            return false;
        }
     
        const auth = new Buffer.from(authHeader.split(' ')[1],'base64').toString().split(':');
        const username = auth[0];
        const password = auth[1];
    
        if(username == null || typeof username != 'string' || password == null || typeof password != 'string')
        {
            appendToLog('MAIN', 'ERROR', 'Username and/or password passed to isAuthorized was invalid.');
            return false;
        }
    
        let secretsJson = await redis.getSecretsJson();
        if(secretsJson.secrets.express.username === username && secretsJson.secrets.express.password === password)
        {
            return true;
        }
        else
        {
            appendToLog('MAIN', 'ERROR', 'Authorization failed with username ' + username + ' and password ' + password + '.');
            return false;
        }
    }
    catch(err)
    {
        appendToLog('MAIN', 'ERROR', 'Exception thrown in isAuthorized: ' + err.message);
        return false;
    }
}


function getUTCTimestampString()
{
    let now = new Date();
    let timestamp_string = now.getUTCFullYear() + '-' + (now.getUTCMonth() + 1) + '-' + now.getUTCDate() + ' ' + now.getUTCHours() + ':' + now.getUTCMinutes() + ':' + now.getUTCSeconds() + '.' + now.getUTCMilliseconds();
    return timestamp_string;
}


router.get('/', (req, res) => {
    try
    {
        res.status(200);
        res.json({
            'timestamp': getUTCTimestampString()
        });
        res.send();
    }
    catch(err)
    {
        res.status(500);
        res.send();
    }
});


router.post('/append-to-log', async (req, res) => {
    // JSON body parameters:
    //  category
    //  level
    //  message
    try
    {
        let authorized = await isAuthorized(req);
        if(authorized != true)
        {
            res.status(400);
            res.send();
            return;
        }

        let category = req.body.category;
        let level = req.body.level;
        let message = req.body.message;
        if(category == null || typeof category != 'string' || level == null || typeof level != 'string' || message == null || typeof message != 'string')
        {
            appendToLog('MAIN', 'ERROR', 'API request made to /append-to-log with invalid category, level and/or message.');
            res.status(400);
            res.send();
        }
        else
        {
            appendToLog(category, level, message);
            res.status(201);
            res.send();
        }
    }
    catch(err)
    {
        appendToLog('MAIN', 'ERROR', 'Exception thrown in /append-to-log: ' + err.message);
        res.status(500);
        res.send();
    }
});


router.post('/log-resource-access', async (req, res) => {
    // JSON body parameters:
    //  resource
    //  ip_address
    try
    {
        let authorized = await isAuthorized(req);
        if(authorized != true)
        {
            res.status(400);
            res.send();
            return;
        }
        
        let resource = req.body.resource;
        let ipAddress = req.body.ip_address;
        if(resource == null || typeof resource != 'string' || ipAddress == null || typeof ipAddress != 'string')
        {
            appendToLog('MAIN', 'ERROR', 'API request made to /log-resource-access with invalid URL and/or IP address.');
            res.status(400);
            res.send();
        }
        else
        {
            logResourceAccess(resource, ipAddress);
            res.status(201);
            res.send();
        }
    }
    catch(err)
    {
        appendToLog('MAIN', 'ERROR', 'Exception thrown in /log-resource-access: ' + err.message);
        res.status(500);
        res.send();
    }
});


router.post('/log-webpage-access', (req, res) => {
    // Query parameters:
    //  webpage
    try
    {
        let webpage = req.query.webpage;
        let ipAddress = req.ip;
        if(webpage == null || typeof webpage != 'string')
        {
            appendToLog('MAIN', 'ERROR', 'API request made to /log-webpage-access with invalid webpage query.');
            res.status(400);
            res.send();
        }
        else
        {
            logResourceAccess(webpage, ipAddress);
            res.status(201);
            res.send();
        }
    }
    catch(err)
    {
        appendToLog('MAIN', 'ERROR', 'Exception thrown in /log-webpage-access: ' + err.message);
        res.status(500);
        res.send();
    }
});


async function appendToLog(category, level, message)
{
    try
    {
        db.query('INSERT INTO express_logs (timestamp, category, level, message) VALUES ($1, $2, $3, $4)', [getUTCTimestampString(), category, level, message]);
    }
    catch(err)
    {
        console.log('Exception thrown in appendToLog. Error message: ' + err.message);
    }
}


async function logResourceAccess(url, ipAddress)
{
    try
    {
        db.query('INSERT INTO resource_access_logs (timestamp, location, ip_address) VALUES ($1, $2, $3)', [getUTCTimestampString(), url, ipAddress]);
    }
    catch(err)
    {
        appendToLog('MAIN', 'ERROR', 'Exception thrown in logResourceAccess: ' + err.message);
    }
}


async function getPostgresConnectionObject()
{
    try
    {
        let pgp = await pgp('postgres://admin:pass@192.168.0.121:5432/cjremmett');
        return pgp;
    }
    catch(err)
    {
        console.log(err.message);
    }
}


function sleep(ms)
{
    return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { router:router, getUTCTimestampString:getUTCTimestampString, appendToLog:appendToLog, logResourceAccess:logResourceAccess, sleep:sleep };

