const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*", // Allow all origins for now (dev)
        methods: ["GET", "POST"]
    }
});

const users = {}; // socketId -> { state, userId }
const userSocketMap = {}; // userId -> socketId

io.on("connection", (socket) => {
    console.log("User connected:", socket.id);
    users[socket.id] = { state: "IDLE" };

    // Register User (map Firebase UID to Socket ID)
    socket.on("register", (userId) => {
        users[socket.id].userId = userId;
        userSocketMap[userId] = socket.id;
        console.log(`Registered user: ${userId} -> ${socket.id}`);
    });

    socket.on("call-request", ({ to: targetUserId, from: callerData }) => {
        const targetSocketId = userSocketMap[targetUserId];

        if (!targetSocketId || !users[targetSocketId]) {
            socket.emit("user-offline");
            return;
        }

        if (users[targetSocketId].state !== "IDLE") {
            socket.emit("user-busy");
            return;
        }

        users[socket.id].state = "CALLING";
        users[targetSocketId].state = "RINGING";

        // Save who we are calling to handle timeouts/rejects properly
        users[socket.id].callingWith = targetSocketId;
        users[targetSocketId].callingWith = socket.id;

        io.to(targetSocketId).emit("incoming-call", {
            from: socket.id,
            caller: callerData
        });

        // Timeout (20 sec)
        setTimeout(() => {
            if (users[targetSocketId]?.state === "RINGING") {
                users[targetSocketId].state = "IDLE";
                if (users[socket.id]) users[socket.id].state = "IDLE";

                io.to(targetSocketId).emit("call-timeout");
                io.to(socket.id).emit("call-rejected", { reason: "timeout" });
            }
        }, 20000);
    });

    socket.on("call-accept", ({ to: targetSocketId }) => {
        if (users[socket.id]) users[socket.id].state = "IN_CALL";
        if (users[targetSocketId]) users[targetSocketId].state = "IN_CALL";

        io.to(targetSocketId).emit("call-accepted", { acceptorSocketId: socket.id });
    });

    socket.on("call-reject", ({ to: targetSocketId }) => {
        if (users[socket.id]) users[socket.id].state = "IDLE";
        if (users[targetSocketId]) users[targetSocketId].state = "IDLE";
        io.to(targetSocketId).emit("call-rejected");
    });

    socket.on("end-call", ({ to: targetSocketId }) => {
        if (users[socket.id]) users[socket.id].state = "IDLE";
        if (users[targetSocketId]) users[targetSocketId].state = "IDLE";
        io.to(targetSocketId).emit("call-ended");
    });

    // WebRTC Signaling Events (Pass-through)
    socket.on("offer", ({ to, offer }) => {
        io.to(to).emit("offer", { offer, from: socket.id });
    });

    socket.on("answer", ({ to, answer }) => {
        io.to(to).emit("answer", { answer, from: socket.id });
    });

    socket.on("ice", ({ to, candidate }) => {
        io.to(to).emit("ice", { candidate, from: socket.id });
    });

    socket.on("disconnect", () => {
        const userId = users[socket.id]?.userId;
        if (userId) delete userSocketMap[userId];
        delete users[socket.id];
        console.log("User disconnected:", socket.id);
    });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log("Server running on port", PORT);
});
