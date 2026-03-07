const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// Store connected users
const users = new Map(); // socketId -> username

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  // Handle joining
  socket.on('join', (username) => {
    users.set(socket.id, username);
    // Notify everyone that a new user joined
    io.emit('user-joined', `${username} joined the chat`);
  });

  // Handle chat messages
  socket.on('send-message', (data) => {
    const username = users.get(socket.id);
    if (username) {
      io.emit('new-message', {
        user: username,
        message: data.message,
        time: new Date().toLocaleTimeString()
      });
    }
  });

  // ---------- Video/Audio Call Signaling ----------
  // When a client wants to start a call, they send an offer.
  // We broadcast the offer to all other clients.
  socket.on('offer', (data) => {
    socket.broadcast.emit('offer', {
      offer: data.offer,
      from: socket.id
    });
  });

  // When a client answers an offer, send the answer back to the offerer.
  socket.on('answer', (data) => {
    io.to(data.to).emit('answer', {
      answer: data.answer,
      from: socket.id
    });
  });

  // ICE candidate exchange
  socket.on('ice-candidate', (data) => {
    io.to(data.to).emit('ice-candidate', {
      candidate: data.candidate,
      from: socket.id
    });
  });

  // ---------- Screen Share Signaling ----------
  // Similar pattern but with different event names to avoid confusion.
  socket.on('screen-offer', (data) => {
    socket.broadcast.emit('screen-offer', {
      offer: data.offer,
      from: socket.id
    });
  });

  socket.on('screen-answer', (data) => {
    io.to(data.to).emit('screen-answer', {
      answer: data.answer,
      from: socket.id
    });
  });

  socket.on('screen-ice-candidate', (data) => {
    io.to(data.to).emit('screen-ice-candidate', {
      candidate: data.candidate,
      from: socket.id
    });
  });

  // Notify others when screen share starts/stops
  socket.on('screen-started', () => {
    const username = users.get(socket.id);
    socket.broadcast.emit('screen-available', {
      sharer: socket.id,
      username: username
    });
  });

  socket.on('screen-stopped', () => {
    socket.broadcast.emit('screen-unavailable');
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    const username = users.get(socket.id);
    if (username) {
      io.emit('user-left', `${username} left the chat`);
      users.delete(socket.id);
    }
    socket.broadcast.emit('screen-unavailable');
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});