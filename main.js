const express = require('express');
const app = express();
const port = 3000;

const fs = require('fs');
const axios = require('axios');

const utils = require('./utils');

// Boilerplate code that automatically converts request bodies to JSON
// See https://masteringjs.io/tutorials/express/body
app.use(express.json());

// Log all requests
app.use((req, res, next) => {
    utils.logResourceAccess('https://cjremmett.com' + req.originalUrl, req.ip);
    next();
});

app.use('/api', utils.router);

app.listen(port, () => {
    app.set('trust proxy', true);
    console.log(`Express.js API listening on port ${port}.`);
    utils.appendToLog('MAIN', 'INFO', `Express.js API listening on port ${port}.`);
});
