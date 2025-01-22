import express from 'express';
const app = express();
const port = 3000;

import { router, logResourceAccess, appendToLog } from './utils.js';
import { photographyRouter } from './photography.js';

// Boilerplate code that automatically converts request bodies to JSON
// See https://masteringjs.io/tutorials/express/body
app.use(express.json());

// Log all requests
app.use((req, res, next) => {
    logResourceAccess('https://cjremmett.com' + req.originalUrl, req.ip);
    next();
});

app.use('/api', router);
app.use('/api/photography', photographyRouter);

app.listen(port, () => {
    app.set('trust proxy', true);
    console.log(`Express.js API listening on port ${port}.`);
    appendToLog('MAIN', 'INFO', `Express.js API listening on port ${port}.`);
});
