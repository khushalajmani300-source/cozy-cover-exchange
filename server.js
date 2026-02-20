require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const path = require('path');

const app = express();

// 1. SERVE THE FRONTEND
app.use(express.static('Public')); 
app.use(express.json());

// 2. DATABASE CONNECTION
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// ==========================================
// 3. API ENDPOINTS
// ==========================================

// Serve the main page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'Public', 'index.html'));
});

// DEALER LOGIN SYSTEM
app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const result = await pool.query(
            'SELECT id, full_name FROM users WHERE username = $1 AND password = $2', 
            [username, password]
        );
        
        if (result.rows.length > 0) {
            res.json({ success: true, user: result.rows[0] });
        } else {
            res.json({ success: false, message: 'Invalid credentials' });
        }
    } catch (err) {
        console.error("Login Error:", err);
        res.status(500).json({ success: false });
    }
});

// Get List of Products
app.get('/api/products', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM products ORDER BY id ASC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).send('Server Error');
    }
});

// Get Price History
app.get('/api/history/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query(
            'SELECT new_price, recorded_at FROM price_history WHERE product_id = $1 ORDER BY recorded_at DESC LIMIT 20',
            [id]
        );
        res.json(result.rows.reverse());
    } catch (err) {
        res.status(500).send('Server Error');
    }
});

// BUY NOW (Transaction) 
app.post('/api/orders', async (req, res) => {
    const client = await pool.connect();
    try {
        const { user_id, product_id, quantity, locked_price } = req.body;
        await client.query('BEGIN');

        const orderRes = await client.query(
            'INSERT INTO orders (user_id, total_amount, status) VALUES ($1, $2, $3) RETURNING id',
            [user_id, locked_price * quantity, 'CONFIRMED']
        );
        const orderId = orderRes.rows[0].id;

        await client.query(
            'INSERT INTO order_items (order_id, product_id, quantity, sold_at_price, subtotal) VALUES ($1, $2, $3, $4, $5)',
            [orderId, product_id, quantity, locked_price, locked_price * quantity]
        );

        await client.query('COMMIT');
        res.json({ success: true, orderId: orderId });
    } catch (err) {
        console.error("Order Error:", err);
        await client.query('ROLLBACK');
        res.status(500).json({ success: false });
    } finally {
        client.release();
    }
});

// ADMIN ONLY - Get All Orders
app.get('/api/admin/orders', async (req, res) => {
    try {
        const query = `
            SELECT o.id AS order_id, u.full_name AS customer, p.name AS product_name,
                   oi.quantity, oi.sold_at_price, o.total_amount, o.status,
                   TO_CHAR(o.created_at, 'DD Mon YYYY, HH:MI AM') as order_date
            FROM orders o
            JOIN users u ON o.user_id = u.id
            JOIN order_items oi ON o.id = oi.order_id
            JOIN products p ON oi.product_id = p.id
            ORDER BY o.created_at DESC;
        `;
        const result = await pool.query(query);
        res.json(result.rows);
    } catch (err) {
        res.status(500).send('Server Error');
    }
});

// ADMIN ONLY - Update Order Status
app.post('/api/admin/order-status', async (req, res) => {
    try {
        const { id, status } = req.body;
        await pool.query('UPDATE orders SET status = $1 WHERE id = $2', [status, id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false });
    }
});

// ADMIN ONLY - Update Volatility
app.post('/api/admin/volatility', async (req, res) => {
    try {
        const { id, volatility } = req.body;
        await pool.query('UPDATE products SET volatility_index = $1 WHERE id = $2', [volatility, id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false });
    }
});

// ==========================================
// 4. THE TRADING BOT ENGINE
// ==========================================
async function updatePrices() {
    const client = await pool.connect();
    try {
        const res = await client.query('SELECT * FROM products WHERE is_active = TRUE');
        for (let product of res.rows) {
             const direction = Math.random() >= 0.5 ? 1 : -1; 
             const baseChange = (Math.random() * 0.05) + 0.01; 
             const percentChange = baseChange * Number(product.volatility_index); 
             
             let newPrice = Number(product.current_price) + (Number(product.current_price) * percentChange * direction);

             if (newPrice < Number(product.floor_price)) newPrice = Number(product.floor_price);
             if (newPrice > Number(product.ceiling_price)) newPrice = Number(product.ceiling_price);

             newPrice = Math.round(newPrice / 10) * 10;

             if (newPrice !== Number(product.current_price)) {
                 await client.query('UPDATE products SET current_price = $1 WHERE id = $2', [newPrice, product.id]);
                 await client.query('INSERT INTO price_history (product_id, new_price) VALUES ($1, $2)', [product.id, newPrice]);
             }
        }
    } catch (err) {
        console.error("Bot Error:", err);
    } finally {
        client.release();
    }
}

setInterval(updatePrices, 4000);

// 5. START SERVER
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});