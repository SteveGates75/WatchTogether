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

// Store connected users and rooms
const users = {};
const rooms = {};

io.on('connection', (socket) => {
  console.log('New user connected:', socket.id);

  // Handle user joining with username
  socket.on('join', (username) => {
    users[socket.id] = {
      id: socket.id,
      username: username,
      room: 'general'
    };
    
    socket.join('general');
    io.to('general').emit('user-joined', {
      user: users[socket.id],
      message: `${username} joined the chat`
    });
    io.to('general').emit('update-users', Object.values(users).filter(u => u.room === 'general'));
  });

  // Handle text messages
  socket.on('send-message', (data) => {
    const user = users[socket.id];
    if (user) {
      io.to(user.room).emit('new-message', {
        user: user.username,
        message: data.message,
        time: new Date().toLocaleTimeString()
      });
    }
  });

  // WebRTC Signaling for voice/video
  socket.on('join-room', (roomId) => {
    const user = users[socket.id];
    if (!user) return;
    
    socket.join(roomId);
    rooms[roomId] = rooms[roomId] || { users: [] };
    rooms[roomId].users.push({ id: socket.id, username: user.username });
    
    // Notify others in the room
    socket.to(roomId).emit('user-connected', {
      id: socket.id,
      username: user.username
    });
    
    // Send existing users to the new joiner
    const existingUsers = rooms[roomId].users.filter(u => u.id !== socket.id);
    socket.emit('existing-users', existingUsers);
  });

  socket.on('offer', (data) => {
    socket.to(data.target).emit('offer', {
      offer: data.offer,
      sender: socket.id
    });
  });

  socket.on('answer', (data) => {
    socket.to(data.target).emit('answer', {
      answer: data.answer,
      sender: socket.id
    });
  });

  socket.on('ice-candidate', (data) => {
    socket.to(data.target).emit('ice-candidate', {
      candidate: data.candidate,
      sender: socket.id
    });
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    const user = users[socket.id];
    if (user) {
      io.to(user.room).emit('user-left', {
        user: user,
        message: `${user.username} left the chat`
      });
      
      // Remove from rooms
      Object.keys(rooms).forEach(roomId => {
        rooms[roomId].users = rooms[roomId].users.filter(u => u.id !== socket.id);
      });
      
      delete users[socket.id];
      io.to('general').emit('update-users', Object.values(users).filter(u => u.room === 'general'));
    }
    console.log('User disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});