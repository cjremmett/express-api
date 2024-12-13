import redis from 'redis';

async function getRedisCursor()
{
    const client = await redis.createClient({ url: 'redis://192.168.0.121:6379' })
    .on('error', err => console.log(err))
    .connect();
    
    return client;
}

async function getSecretsJson()
{
    let redisCursor = await getRedisCursor();
    let secretsJson = await redisCursor.json.get('secrets');
    redisCursor.disconnect();
    return secretsJson;
}

export { getSecretsJson };