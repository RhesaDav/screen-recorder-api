import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import { startRecording } from './recorder';

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.get('/', (req, res) => {
  res.send('Server is running');
});

io.on('connection', (socket) => {
  console.log('a user connected');

  socket.on('start-recording', async (url: string) => {
    try {
      await startRecording(url);
      socket.emit('recording-started');
    } catch (error:any) {
      console.error('Error starting recording:', error);
      socket.emit('recording-error', error.message);
    }
  });

  socket.on('disconnect', () => {
    console.log('user disconnected');
  });
});

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
