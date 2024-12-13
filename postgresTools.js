// db.js
import postgres from 'postgres';

const sql = postgres('postgres://admin:pass@192.168.0.121:5432/cjremmett', {});

export default sql