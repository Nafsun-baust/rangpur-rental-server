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

app.get("/api/equipment", async (req, res) => {
  const query = { status: "approved" };
  const { search, category, rentalType, minPrice, maxPrice, availability, sort } =
    req.query;

  if (search) {
    query.$or = [
      { name: { $regex: search, $options: "i" } },
      { location: { $regex: search, $options: "i" } },
      { category: { $regex: search, $options: "i" } },
    ];
  }
  if (category && category !== "all") query.category = category;
  if (rentalType && rentalType !== "all") query.rentalType = rentalType;
  if (minPrice || maxPrice) {
    query.rentalPrice = {};
    if (minPrice) query.rentalPrice.$gte = Number(minPrice);
    if (maxPrice) query.rentalPrice.$lte = Number(maxPrice);
  }
  if (availability === "available") query.availableQuantity = { $gt: 0 };
  if (availability === "unavailable") query.availableQuantity = { $lte: 0 };

  let sortOption = { createdAt: -1 };
  if (sort === "price_asc") sortOption = { rentalPrice: 1 };
  if (sort === "price_desc") sortOption = { rentalPrice: -1 };

  const result = await equipment.find(query).sort(sortOption).toArray();
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
app.get("/api/favorites", async (req, res) => {
  const filter = req.query.userId
    ? { userId: req.query.userId }
    : req.query.userEmail
    ? { userEmail: req.query.userEmail }
    : {};
  const favDocs = await favorites.find(filter).sort({ createdAt: -1 }).toArray();
  const ids = favDocs
    .map((f) => f.equipmentId)
    .filter((id) => ObjectId.isValid(id))
    .map((id) => new ObjectId(id));
  const items = ids.length ? await equipment.find({ _id: { $in: ids } }).toArray() : [];
  const map = new Map(items.map((item) => [item._id.toString(), item]));
  const result = favDocs
    .map((doc) => ({ ...doc, equipment: map.get(doc.equipmentId) || null }))
    .filter((doc) => doc.equipment);
  res.send(result);
});

app.post("/api/favorites", async (req, res) => {
  const { userId, userEmail, equipmentId } = req.body;
  if (!equipmentId) return res.status(400).send({ message: "equipmentId is required" });
  const existing = await favorites.findOne({
    equipmentId,
    ...(userId ? { userId } : { userEmail }),
  });
  if (existing) return res.send({ alreadyExists: true, favorite: existing });
  const doc = { userId: userId || "", userEmail: userEmail || "", equipmentId, createdAt: new Date() };
  const result = await favorites.insertOne(doc);
  res.status(201).send({ _id: result.insertedId, ...doc });
});

app.delete("/api/favorites/:equipmentId", async (req, res) => {
  const filter = { equipmentId: req.params.equipmentId };
  if (req.query.userId) filter.userId = req.query.userId;
  else if (req.query.userEmail) filter.userEmail = req.query.userEmail;
  const result = await favorites.deleteOne(filter);
  res.send(result);
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});