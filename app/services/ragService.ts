import { Base64 } from 'js-base64';

export class RAGService {
  private static instance: RAGService;
  private ws: WebSocket | null = null;
  private isConnected: boolean = false;
  private connectionPromise: Promise<void> | null = null;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 3;

  private constructor() {}

  static getInstance(): RAGService {
    if (!RAGService.instance) {
      RAGService.instance = new RAGService();
    }
    return RAGService.instance;
  }

  connect(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) {
      return Promise.resolve();
    }

    if (this.connectionPromise) {
      return this.connectionPromise;
    }

    this.connectionPromise = new Promise((resolve, reject) => {
      try {
        console.log('[RAG] Attempting WebSocket connection...');
        this.ws = new WebSocket('ws://localhost:9084');
        
        this.ws.onopen = () => {
          console.log('[RAG] WebSocket connected successfully');
          this.isConnected = true;
          this.reconnectAttempts = 0;
          this.sendInitialSetup();
          resolve();
        };

        this.ws.onclose = () => {
          console.log('[RAG] WebSocket closed');
          this.isConnected = false;
          this.connectionPromise = null;
          
          // Attempt to reconnect if we haven't exceeded max attempts
          if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            console.log(`[RAG] Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
            setTimeout(() => this.connect(), 2000 * this.reconnectAttempts);
          }
        };

        this.ws.onerror = (error) => {
          console.error('[RAG] WebSocket error:', error);
          reject(new Error('Failed to connect to RAG server. Please ensure the server is running on port 9084.'));
        };
      } catch (error) {
        reject(error);
      }
    });

    return this.connectionPromise;
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
      this.isConnected = false;
      this.connectionPromise = null;
    }
  }

  private sendInitialSetup() {
    if (!this.ws || !this.isConnected) return;

    const setupMessage = {
      setup: {
        generation_config: {
          response_modalities: ["AUDIO"]
        }
      }
    };

    this.ws.send(JSON.stringify(setupMessage));
  }

  async uploadPDF(file: File): Promise<void> {
    try {
      console.log('[RAG] Starting PDF upload process for:', file.name);
      console.log('[RAG] File size:', file.size, 'bytes');
      
      // Ensure WebSocket connection
      console.log('[RAG] Ensuring WebSocket connection...');
      await this.connect();

      if (!this.ws || !this.isConnected) {
        throw new Error('WebSocket connection failed');
      }

      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        
        reader.onload = () => {
          try {
            console.log('[RAG] File read successfully, converting to base64...');
            const base64PDF = reader.result?.toString().split(',')[1];
            if (!base64PDF) {
              throw new Error('Failed to convert PDF to base64 - no data found');
            }
            console.log('[RAG] Base64 conversion successful, length:', base64PDF.length);

            const payload = {
              realtime_input: {
                media_chunks: [{
                  mime_type: "application/pdf",
                  data: base64PDF,
                  filename: file.name
                }]
              }
            };

            if (this.ws) {
              console.log('[RAG] Sending PDF data over WebSocket...');
              this.ws.send(JSON.stringify(payload));
              console.log('[RAG] PDF upload completed successfully');
              resolve();
            } else {
              throw new Error('WebSocket connection lost during upload');
            }
          } catch (error) {
            console.error('[RAG] Error processing PDF:', error);
            reject(error);
          }
        };

        reader.onerror = (error) => {
          console.error('[RAG] FileReader error:', error);
          reject(new Error(`Failed to read PDF file: ${error}`));
        };

        reader.onprogress = (event) => {
          if (event.lengthComputable) {
            const progress = (event.loaded / event.total) * 100;
            console.log(`[RAG] Reading file: ${progress.toFixed(2)}%`);
          }
        };

        console.log('[RAG] Starting file read...');
        reader.readAsDataURL(file);
      });
    } catch (error) {
      console.error('[RAG] Upload error:', error);
      throw error;
    }
  }

  async sendAudioChunk(audioData: string) {
    try {
      await this.connect();

      if (!this.ws || !this.isConnected) return;

      const payload = {
        realtime_input: {
          media_chunks: [{
            mime_type: "audio/pcm",
            data: audioData
          }]
        }
      };

      this.ws.send(JSON.stringify(payload));
    } catch (error) {
      console.error('[RAG] Send audio error:', error);
    }
  }

  onMessage(callback: (text: string, audio?: string) => void) {
    if (!this.ws) return;

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.text) {
          callback(data.text);
        }
        if (data.audio) {
          callback(data.text || '', data.audio);
        }
      } catch (error) {
        console.error('[RAG] Error processing message:', error);
      }
    };
  }
} 