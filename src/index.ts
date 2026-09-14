
import express from 'express';
import dotenv from 'dotenv';
import urlRoutes from './routes/url.routes';

dotenv.config();

const app = express();
app.use(express.json());
app.use('/', urlRoutes);

app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log(`Server running on port ${port}`));