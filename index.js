
const express = require('express');
const app = express();
const cors = require('cors')
require('dotenv').config()
const { MongoClient, ServerApiVersion } = require('mongodb');
const port = process.env.PORT || 3000;

// middleware
app.use(cors());
app.use(express.json());


const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster01.g0bc8bl.mongodb.net/?appName=Cluster01`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {

  try {

    await client.connect();
    const db = client.db('zap-shiftdb');
    const parcelsCollection = db.collection('parcels')


    app.post('/parcels', async (req,res) => {

        const parcels = req.body
        const result = await parcelsCollection.insertOne(parcels)
        res.send(result)
    })

    app.get('/parcels', async (req,res) => {

        const {email} = req.query;
        const query = {}
        if(email){
            query.SenderEmail = email
        }
        const result = await parcelsCollection.find(query).toArray()
        res.send(result)


    })






    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");

  } finally {

    // await client.close();
  }
}
run().catch(console.dir);



app.get('/', (req,res) => {
    res.send('zap-shifting')
})

app.listen(port, () => {
    console.log(`zap-shift listening on port ${port}`)
})