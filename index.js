import express from "express";
import cors from "cors";
import "dotenv/config";
import { MongoClient, ObjectId } from "mongodb";
import Stripe from "stripe";
import { createRemoteJWKSet, jwtVerify } from "jose";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

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
app.post("/api/bookings/check-availability", async (req, res) => {
  const { equipmentId, startDate, endDate, quantity } = req.body;
  if (!equipmentId || !ObjectId.isValid(equipmentId)) {
    return res.status(400).send({ available: false, message: "Invalid equipment id" });
  }
  const start = new Date(startDate);
  const end = new Date(endDate);
  const qty = Number(quantity);
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start || !qty || qty < 1) {
    return res.status(400).send({ available: false, message: "Invalid dates or quantity" });
  }
  const item = await equipment.findOne({ _id: new ObjectId(equipmentId) });
  if (!item || item.status !== "approved") {
    return res.status(404).send({ available: false, message: "Equipment not available" });
  }
  if (Number(item.availableQuantity) < qty) {
    return res.status(400).send({ available: false, message: `Only ${item.availableQuantity} units available` });
  }
  const days = Math.max(1, Math.ceil((end - start) / (1000 * 60 * 60 * 24)));
  const units =
    item.rentalType === "Weekly"
      ? Math.max(1, Math.ceil(days / 7))
      : item.rentalType === "Monthly"
      ? Math.max(1, Math.ceil(days / 30))
      : days;
  const totalAmount = Number((units * Number(item.rentalPrice) * qty).toFixed(2));
  res.send({ available: true, days, units, totalAmount, equipmentName: item.name, rentalType: item.rentalType });
});

app.get("/api/bookings/my", async (req, res) => {
  const filter = req.query.customerId
    ? { customerId: req.query.customerId }
    : req.query.customerEmail
    ? { customerEmail: req.query.customerEmail }
    : {};
  const result = await bookings.find(filter).sort({ bookingDate: -1 }).toArray();
  res.send(result);
});

app.get("/api/bookings/owner", async (req, res) => {
  const filter = req.query.ownerId
    ? { ownerId: req.query.ownerId }
    : req.query.ownerEmail
    ? { ownerEmail: req.query.ownerEmail }
    : {};
  const result = await bookings.find(filter).sort({ bookingDate: -1 }).toArray();
  res.send(result);
});

app.get("/api/bookings", async (req, res) => {
  const result = await bookings.find({}).sort({ bookingDate: -1 }).toArray();
  res.send(result);
});

app.patch("/api/bookings/:id/status", async (req, res) => {
  const { id } = req.params;
  const { bookingStatus } = req.body;
  if (!ObjectId.isValid(id) || !["confirmed", "active", "completed", "cancelled"].includes(bookingStatus)) {
    return res.status(400).send({ message: "Invalid request" });
  }
  const result = await bookings.updateOne(
    { _id: new ObjectId(id) },
    { $set: { bookingStatus, updatedAt: new Date() } }
  );
  res.send(result);
});
app.post("/api/payments/checkout-verify", async (req, res) => {
  const { sessionId } = req.body;
  if (!sessionId) {
    return res.status(400).send({ success: false, message: "Session ID is required" });
  }
  const session = await stripe.checkout.sessions.retrieve(sessionId);
  if (session.status !== "complete" || session.payment_status !== "paid") {
    return res.status(400).send({ success: false, message: "Payment not completed" });
  }
  const existingPayment = await payments.findOne({ sessionId });
  if (existingPayment) {
    const existingBooking = await bookings.findOne({ sessionId });
    return res.send({ success: true, alreadyVerified: true, booking: existingBooking, payment: existingPayment });
  }
  const meta = session.metadata || {};
  const qty = Math.max(1, Number(meta.quantity) || 1);
  const amountPaid = (session.amount_total || 0) / 100;
  const transactionId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id || session.id;

  let equipmentDoc = null;
  if (meta.equipmentId && ObjectId.isValid(meta.equipmentId)) {
    equipmentDoc = await equipment.findOne({ _id: new ObjectId(meta.equipmentId) });
    await equipment.updateOne(
      { _id: new ObjectId(meta.equipmentId) },
      { $inc: { availableQuantity: -qty } }
    );
  }

  const bookingDoc = {
    equipmentId: meta.equipmentId || "",
    equipmentName: meta.equipmentName || equipmentDoc?.name || "",
    equipmentImage: equipmentDoc?.image || "",
    ownerId: equipmentDoc?.ownerId || meta.ownerId || "",
    ownerName: equipmentDoc?.ownerName || "",
    ownerEmail: equipmentDoc?.ownerEmail || "",
    customerId: meta.customerId || "",
    customerName: meta.customerName || "",
    customerEmail: meta.customerEmail || session.customer_email || "",
    startDate: meta.startDate || "",
    endDate: meta.endDate || "",
    rentalDurationDays: Number(meta.days) || 1,
    quantity: qty,
    contactNumber: meta.contactNumber || "",
    deliveryAddress: meta.deliveryAddress || "",
    notes: meta.notes || "",
    totalAmount: amountPaid,
    paymentStatus: "paid",
    bookingStatus: "confirmed",
    transactionId,
    sessionId,
    bookingDate: new Date(),
  };

  const bookingResult = await bookings.insertOne(bookingDoc);
  const paymentDoc = {
    sessionId,
    transactionId,
    bookingId: bookingResult.insertedId.toString(),
    equipmentId: bookingDoc.equipmentId,
    customerId: bookingDoc.customerId,
    customerEmail: bookingDoc.customerEmail,
    ownerId: bookingDoc.ownerId,
    amount: amountPaid,
    currency: session.currency || "usd",
    paymentStatus: "paid",
    paidAt: new Date(),
  };
  await payments.insertOne(paymentDoc);
  res.send({ success: true, booking: { _id: bookingResult.insertedId, ...bookingDoc }, payment: paymentDoc });
});

app.get("/api/users/me", async (req, res) => {
  const { email } = req.query;
  if (!email) return res.status(400).send({ message: "Email is required" });
  const user = await users.findOne({ email });
  if (!user) return res.status(404).send({ message: "User not found" });
  res.send(user);
});

app.patch("/api/users/me", async (req, res) => {
  const { email, name, image, phone, address } = req.body;
  if (!email) return res.status(400).send({ message: "Email is required" });
  const updates = { updatedAt: new Date() };
  if (name !== undefined) updates.name = name;
  if (image !== undefined) updates.image = image;
  if (phone !== undefined) updates.phone = phone;
  if (address !== undefined) updates.address = address;
  await users.updateOne({ email }, { $set: updates });
  const updated = await users.findOne({ email });
  res.send(updated);
});

app.get("/api/users", async (req, res) => {
  const result = await users.find({}).sort({ createdAt: -1 }).toArray();
  res.send(result);
});

app.patch("/api/users/:id/role", async (req, res) => {
  const { id } = req.params;
  const { role } = req.body;
  if (!["customer", "owner", "admin"].includes(role)) {
    return res.status(400).send({ message: "Invalid role" });
  }
  const query = ObjectId.isValid(id) ? { _id: new ObjectId(id) } : { _id: id };
  const result = await users.updateOne(query, { $set: { role, updatedAt: new Date() } });
  res.send(result);
});

app.delete("/api/users/:id", async (req, res) => {
  const { id } = req.params;
  const query = ObjectId.isValid(id) ? { _id: new ObjectId(id) } : { _id: id };
  const result = await users.deleteOne(query);
  res.send(result);
});
const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

app.get("/api/analytics/admin", async (req, res) => {
  const [totalUsers, totalEquipment, totalBookings, pendingApprovals, completedRentals, revenueAgg, monthlyAgg] =
    await Promise.all([
      users.countDocuments({}),
      equipment.countDocuments({}),
      bookings.countDocuments({}),
      equipment.countDocuments({ status: "pending" }),
      bookings.countDocuments({ bookingStatus: "completed" }),
      payments.aggregate([{ $match: { paymentStatus: "paid" } }, { $group: { _id: null, total: { $sum: "$amount" } } }]).toArray(),
      bookings
        .aggregate([
          { $group: { _id: { year: { $year: "$bookingDate" }, month: { $month: "$bookingDate" } }, bookings: { $sum: 1 }, revenue: { $sum: "$totalAmount" } } },
          { $sort: { "_id.year": 1, "_id.month": 1 } },
          { $limit: 12 },
        ])
        .toArray(),
    ]);

  const monthlyStats = monthlyAgg.map((m) => ({
    month: `${monthNames[(m._id.month || 1) - 1]} ${m._id.year}`,
    bookings: m.bookings,
    revenue: Number((m.revenue || 0).toFixed(2)),
  }));

  res.send({
    totalUsers,
    totalEquipment,
    totalBookings,
    pendingApprovals,
    completedRentals,
    totalRevenue: Number((revenueAgg[0]?.total || 0).toFixed(2)),
    monthlyStats,
  });
});

app.get("/api/analytics/owner", async (req, res) => {
  const ownerFilter = req.query.ownerId
    ? { ownerId: req.query.ownerId }
    : req.query.ownerEmail
    ? { ownerEmail: req.query.ownerEmail }
    : {};

  const [totalListedEquipment, completedRentals, earningsAgg, monthlyAgg] = await Promise.all([
    equipment.countDocuments(ownerFilter),
    bookings.countDocuments({ ...ownerFilter, bookingStatus: "completed" }),
    bookings.aggregate([{ $match: { ...ownerFilter, paymentStatus: "paid" } }, { $group: { _id: null, total: { $sum: "$totalAmount" } } }]).toArray(),
    bookings
      .aggregate([
        { $match: { ...ownerFilter, paymentStatus: "paid" } },
        { $group: { _id: { year: { $year: "$bookingDate" }, month: { $month: "$bookingDate" } }, earnings: { $sum: "$totalAmount" }, bookings: { $sum: 1 } } },
        { $sort: { "_id.year": 1, "_id.month": 1 } },
        { $limit: 12 },
      ])
      .toArray(),
  ]);

  const monthlyEarnings = monthlyAgg.map((m) => ({
    month: `${monthNames[(m._id.month || 1) - 1]} ${m._id.year}`,
    earnings: Number((m.earnings || 0).toFixed(2)),
    bookings: m.bookings,
  }));

  res.send({
    totalListedEquipment,
    completedRentals,
    totalEarnings: Number((earningsAgg[0]?.total || 0).toFixed(2)),
    monthlyEarnings,
  });
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});