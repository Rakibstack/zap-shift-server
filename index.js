
import express from 'express'
const app = express();

import cors from 'cors'
import dotenv from 'dotenv'
dotenv.config()

import { MongoClient, ServerApiVersion, ObjectId } from "mongodb";
import Stripe from "stripe";
const stripe = new Stripe(process.env.STRIPE_KEY);
import crypto from "crypto";
const port = process.env.PORT || 3000;

import admin from "firebase-admin";
import { readFileSync } from "fs";
const serviceAccount = JSON.parse(
  readFileSync("./zap-shift-client-firebasesdk.json", "utf8")
);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});


function generateTrackingId() {
  const token = crypto.randomBytes(4).toString("hex").toUpperCase();
  return `BD-${token}`;
}

// middleware
app.use(cors());
app.use(express.json());

const verifyFBToken = async (req, res, next) => {

  const authorization = req.headers.authorization
  if (!authorization) {
    return res.status(401).send({ message: 'unauthorized access' })
  }
  const token = authorization.split(' ')[1]
  if (!token) {
    return res.status(401).send({ message: 'unauthorized access' })
  }

  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.decoded_email = decoded.email
    next()
  }
  catch (err) {
    return res.status(401).send({ message: 'unauthorized access.' })
  }
}

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
    const paymentCollection = db.collection('payment')
    const userCollection = db.collection('users')
    const riderCollection = db.collection('riders')
    const trackingCollection = db.collection('tracking')

    const vefifyAdmin = async (req, res, next) => {
      const Email = req.decoded_email
      const query = { Email }
      const user = await userCollection.findOne(query)

      if (!user || user.role !== 'Admin') {
        return res.status(403).send({ message: 'forbidden access' });
      }
      next()
    }
    // Tracking Collection Function
    const logTracking = async (trackingId, status) => {

      const log = {
        trackingId,
        status,
        details: status.split('_').join(' '),
         createdAt: new Date(),
        
      }

      const result = await trackingCollection.insertOne(log)
      // console.log(result);  
      return result;
    }

    // user Related APIS 

    app.post('/users', async (req, res) => {
      const user = req.body;
      user.role = 'user'
      user.createAt = new Date();

      const email = user.Email;
      const alredyexist = await userCollection.findOne({ Email: email })
      if (alredyexist) {
        return res.send({ message: 'User Already Exists' })
      }

      const result = await userCollection.insertOne(user)
      res.send(result)
    })

    app.get('/users/:email/role', async (req, res) => {

      const Email = req.params.email
      const query = { Email }
      const user = await userCollection.findOne(query)
      res.send({ role: user?.role || 'user' })
    })

    app.get('/users', verifyFBToken, async (req, res) => {

      const Email = req.query.email
      const searchText = req.query.searchText
      let query = {}
      if (Email) {
        query.Email = Email
      }
      if (searchText) {
        query.$or = [
          { displayName: { $regex: searchText, $options: 'i' } },
          { Email: { $regex: searchText, $options: 'i' } }
        ]
      }
      const result = await userCollection.find(query).limit(6).sort({ createAt: -1 }).toArray()
      res.send(result)
    })
    app.patch('/users/:id', verifyFBToken, vefifyAdmin, async (req, res) => {
      const id = req.params.id
      const status = req.body.role
      const query = { _id: new ObjectId(id) }
      const updateinfo = {
        $set: {
          role: status
        }
      }
      const result = await userCollection.updateOne(query, updateinfo)
      res.send(result);
    })

    app.delete('/users/:id', verifyFBToken, vefifyAdmin, async (req, res) => {

      const id = req.params.id
      const query = { _id: new ObjectId(id) }
      const result = await userCollection.deleteOne(query)
      res.send(result);
    })

    // riders related APIS.
    app.get('/riders', async (req, res) => {

      const { status, district, workStatus } = req.query
      const query = {}
      if (status) {
        query.status = status
      }
      if (district) {
        query.riderDistrict = district
      }
      if (workStatus) {
        query.workStatus = workStatus
      }
      const result = await riderCollection.find(query).sort({ createAt: -1 }).toArray()
      res.send(result);

    })

    app.post('/riders', verifyFBToken, async (req, res) => {

      const rider = req.body;
      rider.status = 'panding';
      rider.createAt = new Date();

      const result = await riderCollection.insertOne(rider)
      res.send(result);
    })

    app.patch('/riders/:id', verifyFBToken, vefifyAdmin, async (req, res) => {

      const { status, workStatus } = req.body
      const id = req.params.id
      const query = { _id: new ObjectId(id) }
      const updateInfo = {
        $set: {
          status: status,
          workStatus: workStatus
        }
      }
      const result = await riderCollection.updateOne(query, updateInfo)
      // console.log(status);     
      if (status === 'Approved') {
        const Email = req.body.email
        const userquery = {}
        if (Email) {
          userquery.Email = Email
        }
        const update = {
          $set: {
            role: 'Rider'
          }
        }
        const updateInfo = await userCollection.updateOne(userquery, update)
        // console.log(updateInfo);         
      }
      res.send(result);
    })


    app.get('/ridersdetails/:id', verifyFBToken, async (req, res) => {

      const id = req.params.id
      const query = { _id: new ObjectId(id) }
      const result = await riderCollection.findOne(query)
      res.send(result);
    })

    app.delete('/riders/:id', verifyFBToken, vefifyAdmin, async (req, res) => {

      const id = req.params.id
      const query = { _id: new ObjectId(id) }

      const result = await riderCollection.deleteOne(query)
      res.send(result)

    })

    // Parcels Related APIS.
    app.post('/parcels', async (req, res) => {

      const trackingId = generateTrackingId();

      const parcels = req.body
      parcels.createdAt = new Date()
      parcels.trackingId = trackingId

      logTracking(trackingId,'Parcel_Created')
      const result = await parcelsCollection.insertOne(parcels)
      res.send(result)
    })

    app.get('/parcels', verifyFBToken, async (req, res) => {

      const { email, deliveryStatus } = req.query;
      const query = {}
      if (email) {
        query.SenderEmail = email
        if (email !== req.decoded_email) {

          return res.status(403).send({ message: 'forbidden access' })
        }
      }
      // console.log(query, deliveryStatus);

      if (deliveryStatus) {
        query.deliveryStatus = deliveryStatus;
      }
      const options = { sort: { createdAt: -1 } }
      const result = await parcelsCollection.find(query, options).toArray()
      res.send(result)
    })

    app.get('/parcels/rider', verifyFBToken, async (req, res) => {

      const { riderEmail, deliveryStatus } = req.query;
      const query = {}
      if (riderEmail) {
        query.riderEmail = riderEmail
      }

      // if (deliveryStatus) {
      //   query.deliveryStatus = { $in: ['rider_assigned' ,'delivery_onGoing']}
      // }     
      if (deliveryStatus !== 'Parcel_delivered') {
        query.deliveryStatus = { $nin: ['Parcel_delivered'] }
      }
      else{query.deliveryStatus = deliveryStatus}

      const result = await parcelsCollection.find(query).toArray();
      res.send(result)
    })

    app.patch('/parcels/:id/status', verifyFBToken, async (req, res) => {

      const id = req.params.id
      const query = { _id: new ObjectId(id) }
      const { deliveryStatus, riderId,trackingId } = req.body

      const updateStatus = {
        $set: {
          deliveryStatus: deliveryStatus,
        }
      }
      if (deliveryStatus === 'Parcel_delivered') {

        const riderquery = { _id: new ObjectId(riderId) }
        const riderupdatedoc = {
          $set: {
            workStatus: 'available'
          }
        }
        const riderResult = await riderCollection.updateOne(riderquery, riderupdatedoc)
        res.send(riderResult)

      }
      const result = await parcelsCollection.updateOne(query, updateStatus)
      // logtrackingId
      logTracking(trackingId,deliveryStatus)

      res.send(result)
    })

    app.patch('/parcels/:id/reject', verifyFBToken, async (req, res) => {

      const id = req.params.id
      const query = { _id: new ObjectId(id) }

      const rejectInfo = {
        $set: {
          deliveryStatus: 'pending_pickup',
          riderName: null,
          riderEmail: null,
          riderId: null,
        }
      }
      const result = await parcelsCollection.updateOne(query, rejectInfo)
      res.send(result)
    })

    app.patch('/parcels/:id', verifyFBToken, vefifyAdmin, async (req, res) => {

      const { parcelId, riderEmail, riderName, riderId ,trackingId
} = req.body;

      const query = { _id: new ObjectId(parcelId) }
      const updateinfo = {
        $set: {
          deliveryStatus: 'rider_assigned',
          riderName: riderName,
          riderEmail: riderEmail,
          riderId: riderId,
        }
      }
      const result = await parcelsCollection.updateOne(query, updateinfo)

      const riderquery = { _id: new ObjectId(riderId) }
      const riderupdatedoc = {
        $set: {
          workStatus: 'in_delivery'
        }
      }
      const riderResult = await riderCollection.updateOne(riderquery, riderupdatedoc)
      logTracking(trackingId,'in_delivery')
      res.send(riderResult, result)

    })

    app.delete('/parcels/:id', verifyFBToken, async (req, res) => {

      const id = req.params.id
      const query = { _id: new ObjectId(id) }

      const result = await parcelsCollection.deleteOne(query);
      res.send(result);

    })
    app.get('/parcels/:id', verifyFBToken, async (req, res) => {

      const id = req.params.id
      const query = { _id: new ObjectId(id) }
      const result = await parcelsCollection.findOne(query)
      res.send(result);
    })

    // Payment Releted APIS 

    app.get('/payment', verifyFBToken, async (req, res) => {

      const email = req.query.email
      const query = {}
      if (email) {
        query.customerEmail = email
        if (email !== req.decoded_email) {
          return res.status(403).send({ message: 'forbidden access' })
        }
      }
      const result = await paymentCollection.find(query).sort({paidAt: -1}).toArray()
      res.send(result)

    })


    // Checkout Related Apis.
    app.post('/create-checkout-session', async (req, res) => {

      const PaymentInfo = req.body;
      // console.log('payment info', PaymentInfo);

      const amount = parseInt(PaymentInfo.cost) * 100;
      const session = await stripe.checkout.sessions.create(
        {
          line_items: [
            {

              price_data: {
                unit_amount: amount,
                currency: 'USD',
                product_data: {
                  name: PaymentInfo.ParcelName,
                }
              },
              quantity: 1,
            },
          ],
          customer_email: PaymentInfo.senderEmail,
          mode: 'payment',
          metadata: {
            parcelId: PaymentInfo.parcelId,
            parcelName: PaymentInfo.ParcelName,
            trackingId: PaymentInfo.trackingId,
          },
          success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,
        }
      )
      // console.log(session);

      res.send({ url: session.url })
    })

    app.patch('/payment-success', async (req, res) => {

      const sessionId = req.query.session_id;
      const session = await stripe.checkout.sessions.retrieve(sessionId)
      // console.log('after session retrieve', session);
      const transactionId = session.payment_intent
      const query = { transactionId: transactionId }
      const paymentExist = await paymentCollection.findOne(query)
      if (paymentExist) {

        return res.send({
          message: 'Already exist',
          transactionId: transactionId,
          trackingId: paymentExist.trackingId
        })
      }
      // const trackingId = generateTrackingId()

      if (session.payment_status === 'paid') {
        const id = session.metadata.parcelId
        const trackingId=session.metadata.trackingId
        const query = { _id: new ObjectId(id) }
        const update = {
          $set: {
            paymentStatus: 'paid',
            deliveryStatus: 'pending_pickup',
            trackingId: trackingId
          }
        }
        const result = await parcelsCollection.updateOne(query, update);

        const paymentHistory = {

          amount: session.amount_total / 100,
          currency: session.currency,
          customerEmail: session.customer_email,
          parcelId: session.metadata.parcelId,
          transactionId: session.payment_intent,
          paymentStatus: session.payment_status,
          parcelName: session.metadata.parcelName,
          paidAt: new Date(),
          trackingId: trackingId
        }

        if (session.payment_status === 'paid') {

          const paymentResult = await paymentCollection.insertOne(paymentHistory)
          // logTracking function
            logTracking(trackingId,'pending_pickup')

          res.send({ success: true, trackingId: trackingId, transactionId: session.payment_intent, modifyPercel: result, paymentInfo: paymentResult })

        }
      }
    })

    app.get('/tracking/:trackingId/logs', async (req,res) => {

      const trackingId= req.params.trackingId
      const query = {trackingId}

      const result = await trackingCollection.find(query).toArray()
      // console.log(result);
      
      res.send(result);
    })

    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");

  } finally {

    // await client.close();
  }
}
run().catch(console.dir);



app.get('/', (req, res) => {
  res.send('zap-shifting')
})

app.listen(port, () => {
  console.log(`zap-shift listening on port ${port}`)
})