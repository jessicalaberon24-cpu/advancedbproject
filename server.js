require("dotenv").config();

const express = require("express");
const mysql = require("mysql2");
const bcrypt = require("bcrypt");
const cors = require("cors");
const path = require("path");

const app = express();

const PORT = process.env.PORT || 3000;

const BASE_URL = (
    process.env.BASE_URL ||
    "http://localhost:3000"
).replace(/\/$/, "");


app.use(cors());
app.use(express.json());

// DEMO: kapag bumalik galing Maya, Paid + To Ship na ang order.
// Dapat NAUUNA ito sa express.static.
app.get("/success.html", (req, res) => {
    const orderNumber = req.query.orderNumber;

    const sendPage = () =>
        res.sendFile(
            path.join(__dirname, "public", "success.html")
        );

    if (!orderNumber) {
        return sendPage();
    }

    db.query(
        `UPDATE orders
         SET payment_status = 'Paid',
             order_status = 'To Ship'
         WHERE order_number = ?
           AND payment_method = 'PayMaya'`,
        [orderNumber],
        (err) => {
            if (err) {
                console.error("Success page update error:", err);
            }

            sendPage();
        }
    );
});

app.use(
    express.static(
        path.join(__dirname, "public")
    )
);



// =========================
// MYSQL DATABASE
// =========================

const db = mysql.createPool({
    host: process.env.DB_HOST || "localhost",
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME || "budgetphone",
    timezone: "Z",                      // <-- IDAGDAG ITO
    ssl: process.env.DB_HOST
        ? { rejectUnauthorized: true }
        : undefined
});

db.getConnection((err, connection) => {
    if (err) {
        console.error("MySQL connection error:", err);
        return;
    }

    console.log(
        "Connected to MySQL: " +
        (process.env.DB_NAME || "budgetphone")
    );

    connection.release();
});

// =========================
// TEST API
// =========================

app.get("/api", (req, res) => {
    res.json({
        success: true,
        message: "BudgetPhone.ph - Laberon Shop API is running."
    });
});

// =========================
// REGISTER
// =========================

app.post("/api/register", async (req, res) => {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
        return res.status(400).json({
            success: false,
            message: "Please complete all fields."
        });
    }

    try {
        const hashedPassword = await bcrypt.hash(
            password,
            10
        );

        const sql = `
            INSERT INTO users
            (name, email, password)
            VALUES (?, ?, ?)
        `;

        db.query(
            sql,
            [name, email, hashedPassword],
            (err) => {
                if (err) {
                    console.error(err);

                    if (err.code === "ER_DUP_ENTRY") {
                        return res.status(400).json({
                            success: false,
                            message: "Email already exists."
                        });
                    }

                    return res.status(500).json({
                        success: false,
                        message: "Registration failed."
                    });
                }

                return res.json({
                    success: true,
                    message: "Registration successful."
                });
            }
        );
    } catch (error) {
        console.error(error);

        return res.status(500).json({
            success: false,
            message: "Registration failed."
        });
    }
});

// =========================
// LOGIN
// =========================

app.post("/api/login", (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({
            success: false,
            message: "Please enter email and password."
        });
    }

    const sql = `
        SELECT *
        FROM users
        WHERE email = ?
    `;

    db.query(sql, [email], async (err, results) => {
        if (err) {
            console.error(err);

            return res.status(500).json({
                success: false,
                message: "Login failed."
            });
        }

        if (results.length === 0) {
            return res.status(401).json({
                success: false,
                message: "Invalid email or password."
            });
        }

        try {
            const user = results[0];

            const passwordMatch = await bcrypt.compare(
                password,
                user.password
            );

            if (!passwordMatch) {
                return res.status(401).json({
                    success: false,
                    message: "Invalid email or password."
                });
            }

            return res.json({
                success: true,
                message: "Login successful.",
                user: {
                    id: user.id,
                    name: user.name,
                    email: user.email
                }
            });
        } catch (error) {
            console.error("Password verification error:", error);

            return res.status(500).json({
                success: false,
                message: "Login failed."
            });
        }
    });
});

// =========================
// GET PRODUCTS
// =========================

app.get("/api/products", (req, res) => {
    const sql = `
        SELECT *
        FROM products
        ORDER BY id ASC
    `;

    db.query(sql, (err, results) => {
        if (err) {
            console.error(err);

            return res.status(500).json({
                success: false,
                message: "Unable to load products."
            });
        }

        return res.json({
            success: true,
            products: results
        });
    });
});

// =========================
// CREATE ORDER FUNCTION
// =========================

function createOrder(
    cart,
    userId,
    paymentMethod,
    paymentStatus,
    orderStatus,
    callback
) {
    const orderNumber = "BGP-" + Date.now();

    let total = 0;

    cart.forEach((item) => {
        total +=
            Number(item.price) *
            Number(item.quantity);
    });

    const orderSQL = `
        INSERT INTO orders
        (
            user_id,
            order_number,
            total,
            payment_method,
            payment_status,
            order_status
        )
        VALUES (?, ?, ?, ?, ?, ?)
    `;

    db.query(
        orderSQL,
        [
            userId,
            orderNumber,
            total,
            paymentMethod,
            paymentStatus,
            orderStatus
        ],
        (err, result) => {
            if (err) {
                console.error("Create order error:", err);
                return callback(err);
            }

            const orderId = result.insertId;

            const values = cart.map((item) => [
                orderId,
                item.id,
                item.name,
                Number(item.price),
                Number(item.quantity),
                Number(item.price) * Number(item.quantity)
            ]);

            const itemsSQL = `
                INSERT INTO order_items
                (
                    order_id,
                    product_id,
                    product_name,
                    price,
                    quantity,
                    subtotal
                )
                VALUES ?
            `;

            db.query(itemsSQL, [values], (err2) => {
                if (err2) {
                    console.error("Create order items error:", err2);
                    return callback(err2);
                }

                return callback(
                    null,
                    orderNumber,
                    total
                );
            });
        }
    );
}

// =========================
// CASH ON DELIVERY
// =========================

app.post("/api/checkout-cod", (req, res) => {
    const {
        cart,
        userId,
        deliveryName,
        deliveryPhone,
        deliveryAddress
    } = req.body;

    if (
        !cart ||
        !cart.length ||
        !userId ||
        !deliveryName ||
        !deliveryPhone ||
        !deliveryAddress
    ) {
        return res.status(400).json({
            success: false,
            message: "Please complete all delivery information."
        });
    }

    createOrder(
        cart,
        userId,
        "COD",
        "Pending",
        "To Ship",
        (err, orderNumber, total) => {
            if (err) {
                console.error(err);

                return res.status(500).json({
                    success: false,
                    message: "Unable to create COD order."
                });
            }

            const sql = `
                UPDATE orders
                SET
                    delivery_name = ?,
                    delivery_phone = ?,
                    delivery_address = ?
                WHERE order_number = ?
                AND user_id = ?
            `;

            db.query(
                sql,
                [
                    deliveryName.trim(),
                    deliveryPhone.trim(),
                    deliveryAddress.trim(),
                    orderNumber,
                    userId
                ],
                (updateErr) => {
                    if (updateErr) {
                        console.error(updateErr);

                        return res.status(500).json({
                            success: false,
                            message:
                                "Order created, but saving delivery details failed. Please contact the shop administrator before trying again."
                        });
                    }

                    return res.json({
                        success: true,
                        message: "COD order created.",
                        orderNumber: orderNumber,
                        total: total
                    });
                }
            );
        }
    );
});

// =========================
// GET USER ORDERS
// =========================

app.get("/api/orders/:userId", (req, res) => {
    const userId = req.params.userId;

    const sql = `
        SELECT
            o.id,
            o.order_number,
            o.total,
            o.payment_method,
            o.payment_status,
            o.order_status,
            o.created_at,
            COALESCE(o.delivery_name, '') AS delivery_name,
            COALESCE(o.delivery_phone, '') AS delivery_phone,
            COALESCE(o.delivery_address, '') AS delivery_address,
            oi.product_id,
            oi.product_name,
            oi.price,
            oi.quantity,
            oi.subtotal
        FROM orders o
        LEFT JOIN order_items oi
            ON o.id = oi.order_id
        WHERE o.user_id = ?
        ORDER BY o.id DESC
    `;

    db.query(sql, [userId], (err, results) => {
        if (err) {
            console.error("GET USER ORDERS ERROR:", err);

            return res.status(500).json({
                success: false,
                message: "Unable to load orders."
            });
        }

        console.log(
            "ORDERS DELIVERY DATA:",
            results.map((order) => ({
                order_number: order.order_number,
                payment_method: order.payment_method,
                delivery_name: order.delivery_name,
                delivery_phone: order.delivery_phone,
                delivery_address: order.delivery_address
            }))
        );

        return res.json({
            success: true,
            orders: results
        });
    });
});

// =========================
// MAYA SANDBOX
// =========================

const MAYA_BASE_URL =
    "https://pg-sandbox.paymaya.com";

// Maya Sandbox API keys
const MAYA_PUBLIC_KEY =
    process.env.MAYA_PUBLIC_KEY ||
    "pk-Z0OSzLvIcOI2UIvDhdTGVVfRSSeiGStnceqwUE7n0Ah";

const MAYA_SECRET_KEY =
    process.env.MAYA_SECRET_KEY || "";

// =========================
// MAYA CHECKOUT
// =========================

app.post("/api/checkout", (req, res) => {
    const {
        cart,
        userId,
        deliveryName,
        deliveryPhone,
        deliveryAddress
    } = req.body;

    if (
        !cart ||
        !cart.length ||
        !userId ||
        !deliveryName?.trim() ||
        !deliveryPhone?.trim() ||
        !deliveryAddress?.trim()
    ) {
        return res.status(400).json({
            success: false,
            message:
                "Please complete all checkout and delivery information."
        });
    }

    if (
        !MAYA_PUBLIC_KEY ||
        MAYA_PUBLIC_KEY ===
            "PASTE_YOUR_MAYA_SANDBOX_PUBLIC_KEY_HERE"
    ) {
        return res.status(503).json({
            success: false,
            message:
                "Maya Sandbox is not configured yet. Add your Maya Sandbox public key."
        });
    }

    createOrder(
        cart,
        userId,
        "PayMaya",
        "Pending",
        "To Pay",
        async (err, orderNumber, total) => {
            if (err) {
                console.error("Create Maya order error:", err);

                return res.status(500).json({
                    success: false,
                    message: "Unable to create order."
                });
            }

            // SAVE DELIVERY DETAILS
            try {
                await new Promise((resolve, reject) => {
                    db.query(
                        `UPDATE orders
                         SET delivery_name = ?,
                             delivery_phone = ?,
                             delivery_address = ?
                         WHERE order_number = ?`,
                        [
                            deliveryName.trim(),
                            deliveryPhone.trim(),
                            deliveryAddress.trim(),
                            orderNumber
                        ],
                        (saveErr) => {
                            if (saveErr) {
                                return reject(saveErr);
                            }

                            resolve();
                        }
                    );
                });
            } catch (saveError) {
                console.error(
                    "Delivery details save error:",
                    saveError
                );

                return res.status(500).json({
                    success: false,
                    message:
                        "Unable to save delivery information."
                });
            }

            // MAYA CHECKOUT REQUEST
            // Panatilihin ang working checkout endpoint at request.

            console.log("Maya URL:", MAYA_BASE_URL);

console.log(
    "Maya public key source:",
    process.env.MAYA_PUBLIC_KEY
        ? ".env or environment variable"
        : "server.js fallback"
);

console.log(
    "Maya public key prefix:",
    MAYA_PUBLIC_KEY.slice(0, 3)
);
            try {
                const response = await fetch(
                    MAYA_BASE_URL +
                        "/checkout/v1/checkouts",
                    {
                        method: "POST",

                        headers: {
                            "Content-Type": "application/json",

                            "Authorization":
                                "Basic " +
                                Buffer.from(
                                    MAYA_PUBLIC_KEY + ":"
                                ).toString("base64")
                        },

                        body: JSON.stringify({
                            totalAmount: {
                                value: total,
                                currency: "PHP"
                            },

                            buyer: {
                                firstName: "BudgetPhone",
                                lastName: "Customer"
                            },

                            redirectUrl: {
                                success:
                                    BASE_URL +
                                    "/success.html?orderNumber=" +
                                    orderNumber,

                                failure:
                                    BASE_URL +
                                    "/failure.html?orderNumber=" +
                                    orderNumber,

                                cancel:
                                    BASE_URL +
                                    "/cancel.html?orderNumber=" +
                                    orderNumber
                            },

                            requestReferenceNumber: orderNumber,

                            items: cart.map((item) => ({
                                name: item.name,

                                quantity: Number(item.quantity),

                                totalAmount: {
                                    value:
                                        Number(item.price) *
                                        Number(item.quantity),

                                    currency: "PHP"
                                }
                            }))
                        })
                    }
                );

                const data = await response.json();

                if (!response.ok) {
                    console.error("Maya Error:", data);

                    return res.status(500).json({
                        success: false,
                        message: "Maya checkout failed."
                    });
                }

                // SAVE MAYA CHECKOUT ID TO DATABASE
                // Idinadagdag ito pagkatapos ng successful
                // Maya checkout response.
                if (!data.checkoutId) {
                    console.error(
                        "Maya did not return a checkout ID:",
                        data
                    );

                    return res.status(502).json({
                        success: false,
                        message:
                            "Maya did not return a checkout ID."
                    });
                }

                await new Promise((resolve, reject) => {
                    db.query(
                        `UPDATE orders
                         SET checkout_id = ?
                         WHERE order_number = ?`,
                        [
                            data.checkoutId,
                            orderNumber
                        ],
                        (saveErr, result) => {
                            if (saveErr) {
                                return reject(saveErr);
                            }

                            if (result.affectedRows === 0) {
                                return reject(
                                    new Error(
                                        "Order not found when saving checkout ID."
                                    )
                                );
                            }

                            resolve();
                        }
                    );
                });

                // RETURN CHECKOUT INFORMATION TO FRONTEND
                return res.json({
                    success: true,
                    redirectUrl: data.redirectUrl,
                    checkoutId: data.checkoutId,
                    orderNumber: orderNumber
                });

            } catch (error) {
                console.error(
                    "Maya checkout or checkout ID save error:",
                    error
                );

                return res.status(500).json({
                    success: false,
                    message:
                        "Maya checkout failed or checkout information could not be saved."
                });
            }
        }
    );
});

// =========================
// CONFIRM MAYA PAYMENT
// =========================

app.post(
    "/api/orders/confirm-payment",
    async (req, res) => {
        const { orderNumber, checkoutId } = req.body;

        if (!orderNumber || !checkoutId) {
            return res.status(400).json({
                success: false,
                message: "Missing payment information."
            });
        }

        try {
            // FIND ORDER IN DATABASE
            const orders = await new Promise(
                (resolve, reject) => {
                    db.query(
                        `SELECT checkout_id, payment_status
                         FROM orders
                         WHERE order_number = ?
                         LIMIT 1`,
                        [orderNumber],
                        (err, rows) => {
                            if (err) {
                                return reject(err);
                            }

                            resolve(rows);
                        }
                    );
                }
            );

            if (orders.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: "Order not found."
                });
            }

            const order = orders[0];

            // CHECK WHETHER CHECKOUT ID MATCHES THE ORDER
            if (
                !order.checkout_id ||
                order.checkout_id !== checkoutId
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Checkout ID does not match this order."
                });
            }

            // DO NOT VERIFY AN ALREADY-PAID ORDER AGAIN
            if (order.payment_status === "Paid") {
                return res.json({
                    success: true,
                    message: "Payment was already confirmed.",
                    orderNumber: orderNumber
                });
            }

            // VERIFY PAYMENT STATUS USING MAYA PUBLIC KEY
            const verifyUrl =
                MAYA_BASE_URL +
                "/payments/v1/payments/" +
                encodeURIComponent(checkoutId) +
                "/status";

            console.log(
                "MAYA STATUS URL:",
                verifyUrl
            );

            const response = await fetch(
                verifyUrl,
                {
                    method: "GET",

                    headers: {
                        "Authorization":
                            "Basic " +
                            Buffer.from(
                                MAYA_PUBLIC_KEY + ":"
                            ).toString("base64"),

                        "Accept": "application/json"
                    }
                }
            );

            const data = await response.json();

            console.log(
                "MAYA PAYMENT STATUS RESPONSE:",
                data
            );

            if (!response.ok) {
                return res.status(502).json({
                    success: false,
                    message:
                        "Maya could not verify payment. Check server terminal."
                });
            }

            const paymentStatus =
                typeof data === "string"
                    ? data
                    : data.status || data.paymentStatus;

            if (paymentStatus !== "PAYMENT_SUCCESS") {
                return res.status(400).json({
                    success: false,
                    message:
                        "Payment is not confirmed as successful."
                });
            }

            // UPDATE THE MATCHING ORDER
            const result = await new Promise(
                (resolve, reject) => {
                    db.query(
                        `UPDATE orders
                         SET payment_status = 'Paid',
                             order_status = 'To Ship'
                         WHERE order_number = ?
                           AND checkout_id = ?`,
                        [
                            orderNumber,
                            checkoutId
                        ],
                        (err, updateResult) => {
                            if (err) {
                                return reject(err);
                            }

                            resolve(updateResult);
                        }
                    );
                }
            );

            if (result.affectedRows === 0) {
                return res.status(500).json({
                    success: false,
                    message:
                        "Unable to update order status."
                });
            }

            return res.json({
                success: true,
                message: "Payment confirmed.",
                orderNumber: orderNumber
            });

        } catch (error) {
            console.error(
                "Payment verification error:",
                error
            );

            return res.status(500).json({
                success: false,
                message: "Payment verification failed."
            });
        }
    }
);

// =========================
// START SERVER
// =========================

app.listen(PORT, () => {
    console.log(
        `BudgetPhone.ph - Laberon Shop running at http://localhost:${PORT}`
    );
});
