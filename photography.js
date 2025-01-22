import express from 'express';
const photographyRouter = express.Router();

photographyRouter.get('/test123', async (req, res) => {
    try
    {
        res.status(200);
        res.send();
    }
    catch(err)
    {
        res.status(500);
        res.send();
    }
});

export { photographyRouter };

