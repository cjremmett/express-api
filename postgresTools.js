// Copy/pasted from https://vitaly-t.github.io/pg-promise/Database.html

// Proper way to initialize and share the Database object

// Loading and initializing the library:
const pgp = require('pg-promise')({
    // Initialization Options
});

// Preparing the connection details:
const cn = 'postgres://admin:pass@192.168.0.121:5432/cjremmett';

// Creating a new database instance from the connection details:
const db = pgp(cn);

// Exporting the database object for shared use:
module.exports = db;