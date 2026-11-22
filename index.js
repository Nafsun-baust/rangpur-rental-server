import express from "express";
import cors from "cors";
import "dotenv/config";

const app = express();
const port = process.env.PORT || 5000;

app.use(express.json());
app.use(cors());

app.get("/", (req, res) => {
  res.send({ message: "Equipment Rental Rangpur server is running" });
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});