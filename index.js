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

app.post("/api/equipment", async (req, res) => {
  const item = {
    ...req.body,
    rentalPrice: Number(req.body.rentalPrice) || 0,
    availableQuantity: Number(req.body.availableQuantity) || 1,
    status: "pending",
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const result = await equipment.insertOne(item);
  res.status(201).send(result);
});
app.patch("/api/equipment/:id", async (req, res) => {
  const { id } = req.params;
  if (!ObjectId.isValid(id)) {
    return res.status(400).send({ message: "Invalid equipment id" });
  }
  const { _id, ...updates } = req.body;
  if (updates.rentalPrice !== undefined) {
    updates.rentalPrice = Number(updates.rentalPrice);
  }
  if (updates.availableQuantity !== undefined) {
    updates.availableQuantity = Number(updates.availableQuantity);
  }
  const result = await equipment.updateOne(
    { _id: new ObjectId(id) },
    { $set: { ...updates, updatedAt: new Date() } }
  );
  res.send(result);
});

app.delete("/api/equipment/:id", async (req, res) => {
  const { id } = req.params;
  if (!ObjectId.isValid(id)) {
    return res.status(400).send({ message: "Invalid equipment id" });
  }
  const result = await equipment.deleteOne({ _id: new ObjectId(id) });
  res.send(result);
});

app.get("/api/equipment/featured", async (req, res) => {
  const result = await equipment
    .find({ status: "approved" })
    .sort({ createdAt: -1 })
    .limit(6)
    .toArray();
  res.send(result);
});

app.get("/api/equipment", async (req, res) => {
  const result = await equipment
    .find({ status: "approved" })
    .sort({ createdAt: -1 })
    .toArray();
  res.send(result);
});

app.get("/api/equipment/:id", async (req, res) => {
  const { id } = req.params;
  if (!ObjectId.isValid(id)) {
    return res.status(400).send({ message: "Invalid equipment id" });
  }
  const result = await equipment.findOne({ _id: new ObjectId(id) });
  if (!result) {
    return res.status(404).send({ message: "Equipment not found" });
  }
  res.send(result);
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});