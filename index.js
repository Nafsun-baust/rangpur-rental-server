import express from "express";
import cors from "cors";
import "dotenv/config";
import { MongoClient, ObjectId } from "mongodb";

const app = express();
const port = process.env.PORT || 5000;

app.use(express.json());
app.use(cors());

const client = new MongoClient(process.env.MONGODB_URI);

async function connectToMongoDB() {
  await client.connect();
  console.log("Connected to MongoDB");
  return client;
}

const connectedClient = await connectToMongoDB();
const db = connectedClient.db(process.env.DB_NAME || "equipment_rental_db");
const users = db.collection("user");
const sessions = db.collection("session");
const equipment = db.collection("equipment");
const bookings = db.collection("bookings");
const payments = db.collection("payments");
const favorites = db.collection("favorites");

app.get("/", (req, res) => {
  res.send({ message: "Equipment Rental Rangpur server is running" });
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});