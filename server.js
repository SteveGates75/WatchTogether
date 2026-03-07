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

// Store usernames
const users = new Map(); // socketId -> username

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // User joins with username
  socket.on('join', (username) => {
    users.set(socket.id, username);
    io.emit('user-joined', `${username} joined the chat`);
  });

  // Chat message
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

  // ----- Call Signaling -----
  // Offer is broadcast to everyone except sender
  socket.on('offer', (data) => {
    socket.broadcast.emit('offer', {
      offer: data.offer,
      from: socket.id
    });
  });

  // Answer goes directly to the caller
  socket.on('answer', (data) => {
    io.to(data.to).emit('answer', {
      answer: data.answer,
      from: socket.id
    });
  });

  // ICE candidate goes directly to the target
  socket.on('ice-candidate', (data) => {
    io.to(data.to).emit('ice-candidate', {
      candidate: data.candidate,
      from: socket.id
    });
  });

  // ----- Screen Share Signaling -----
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

  // Screen share started/stopped notifications
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

  // Disconnect
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