// app/components/CameraPreview.tsx
"use client";

import { useEffect, useRef, useState, useCallback } from 'react';
import { Button } from "../../components/ui/button";
import { Video, VideoOff, Monitor, Camera as CameraIcon, PenTool, FileText } from "lucide-react";
import { GeminiWebSocket } from '../services/geminiWebSocket';
import { RAGService } from '../services/ragService';
import { Base64 } from 'js-base64';
import MathCanvas from './MathCanvas';
import PDFViewer from './PDFViewer';

type InputMode = 'camera' | 'screen' | 'math' | 'pdf';

interface CameraPreviewProps {
  onTranscription: (text: string) => void;
}

export default function CameraPreview({ onTranscription }: CameraPreviewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [isFrontCamera, setIsFrontCamera] = useState(true);
  const [audioLevel, setAudioLevel] = useState(0);
  const geminiWsRef = useRef<GeminiWebSocket | null>(null);
  const videoCanvasRef = useRef<HTMLCanvasElement>(null);
  const audioWorkletNodeRef = useRef<AudioWorkletNode | null>(null);
  const [isAudioSetup, setIsAudioSetup] = useState(false);
  const setupInProgressRef = useRef(false);
  const [isWebSocketReady, setIsWebSocketReady] = useState(false);
  const imageIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const [isModelSpeaking, setIsModelSpeaking] = useState(false);
  const [outputAudioLevel, setOutputAudioLevel] = useState(0);
  const [connectionStatus, setConnectionStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');
  const [inputMode, setInputMode] = useState<InputMode>('camera');
  const ragService = RAGService.getInstance();

  const cleanupAudio = useCallback(() => {
    if (audioWorkletNodeRef.current) {
      audioWorkletNodeRef.current.disconnect();
      audioWorkletNodeRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
  }, []);

  const cleanupWebSocket = useCallback(() => {
    if (geminiWsRef.current) {
      geminiWsRef.current.disconnect();
      geminiWsRef.current = null;
    }
  }, []);

  // Simplify sendAudioData to just send continuously
  const sendAudioData = (b64Data: string) => {
    if (!geminiWsRef.current) return;
    geminiWsRef.current.sendMediaChunk(b64Data, "audio/pcm");
  };

  const toggleStream = async () => {
    if (isStreaming && stream) {
      setIsStreaming(false);
      cleanupWebSocket();
      cleanupAudio();
      stream.getTracks().forEach(track => track.stop());
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
      setStream(null);
    } else {
      await startStream();
    }
  };

  const startStream = async () => {
    try {
      // Clean up any existing streams first
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
      
      if (inputMode === 'pdf') {
        // For PDF mode, we only need audio stream
        const audioStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            sampleRate: 16000,
            channelCount: 1,
            echoCancellation: true,
            autoGainControl: true,
            noiseSuppression: true,
          }
        });

        audioContextRef.current = new AudioContext({
          sampleRate: 16000,
        });

        setStream(audioStream);
        setIsStreaming(true);
        return;
      }

      if (inputMode === 'math') {
        // For math mode, use screen capture like screen sharing mode
        const videoStream = await navigator.mediaDevices.getDisplayMedia({ 
          video: {
            displaySurface: "window",
          }, 
          audio: false 
        });

        const audioStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            sampleRate: 16000,
            channelCount: 1,
            echoCancellation: true,
            autoGainControl: true,
            noiseSuppression: true,
          }
        });

        audioContextRef.current = new AudioContext({
          sampleRate: 16000,
        });

        if (videoRef.current) {
          videoRef.current.srcObject = videoStream;
          videoRef.current.muted = true;
        }

        const combinedStream = new MediaStream([
          ...videoStream.getTracks(),
          ...audioStream.getTracks()
        ]);

        // Add event listener for screen sharing ended
        videoStream.getVideoTracks()[0].addEventListener('ended', () => {
          setIsStreaming(false);
          cleanupWebSocket();
          cleanupAudio();
          if (stream) {
            stream.getTracks().forEach(track => track.stop());
          }
        });

        setStream(combinedStream);
        setIsStreaming(true);
        return;
      }

      // Get appropriate video stream based on mode
      const videoStream = inputMode === 'screen'
        ? await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
        : await navigator.mediaDevices.getUserMedia({ 
            video: true,
            audio: false
          });

      const audioStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          autoGainControl: true,
          noiseSuppression: true,
        }
      });

      audioContextRef.current = new AudioContext({
        sampleRate: 16000,
      });

      if (videoRef.current) {
        videoRef.current.srcObject = videoStream;
        videoRef.current.muted = true;
      }

      const combinedStream = new MediaStream([
        ...videoStream.getTracks(),
        ...audioStream.getTracks()
      ]);

      // Add event listener for screen sharing ended
      if (inputMode === 'screen') {
        videoStream.getVideoTracks()[0].addEventListener('ended', () => {
          setInputMode('camera');
          if (isStreaming) {
            startStream();
          }
        });
      }

      setStream(combinedStream);
      setIsStreaming(true);
    } catch (err) {
      console.error(`Error accessing ${inputMode === 'screen' ? 'screen' : 'camera'}:`, err);
      cleanupAudio();
      if (inputMode === 'screen') {
        setInputMode('camera');
        startStream();
      }
    }
  };

  const toggleCameraFacing = async () => {
    if (!isStreaming || inputMode === 'screen') return;
    
    // Stop current stream
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
    }

    try {
      // Get new video stream with opposite facing mode
      const newVideoStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: isFrontCamera ? 'environment' : 'user'
        },
        audio: false
      });

      // Get audio stream
      const audioStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          autoGainControl: true,
          noiseSuppression: true,
        }
      });

      if (videoRef.current) {
        videoRef.current.srcObject = newVideoStream;
        videoRef.current.muted = true;
      }

      const combinedStream = new MediaStream([
        ...newVideoStream.getTracks(),
        ...audioStream.getTracks()
      ]);

      setStream(combinedStream);
      setIsFrontCamera(!isFrontCamera);
    } catch (err) {
      console.error('Error switching camera:', err);
    }
  };

  // Initialize WebSocket connection
  useEffect(() => {
    if (!isStreaming) {
      setConnectionStatus('disconnected');
      return;
    }

    setConnectionStatus('connecting');
    geminiWsRef.current = new GeminiWebSocket(
      (text) => {
        console.log("Received from Gemini:", text);
      },
      () => {
        console.log("[Camera] WebSocket setup complete, starting media capture");
        setIsWebSocketReady(true);
        setConnectionStatus('connected');
      },
      (isPlaying) => {
        setIsModelSpeaking(isPlaying);
      },
      (level) => {
        setOutputAudioLevel(level);
      },
      onTranscription
    );
    geminiWsRef.current.connect();

    return () => {
      if (imageIntervalRef.current) {
        clearInterval(imageIntervalRef.current);
        imageIntervalRef.current = null;
      }
      cleanupWebSocket();
      setIsWebSocketReady(false);
      setConnectionStatus('disconnected');
    };
  }, [isStreaming, onTranscription, cleanupWebSocket]);

  // Start image capture only after WebSocket is ready
  useEffect(() => {
    if (!isStreaming || !isWebSocketReady) return;

    console.log("[Camera] Starting image capture interval");
    imageIntervalRef.current = setInterval(captureAndSendImage, 1000);

    return () => {
      if (imageIntervalRef.current) {
        clearInterval(imageIntervalRef.current);
        imageIntervalRef.current = null;
      }
    };
  }, [isStreaming, isWebSocketReady]);

  // Update audio processing setup
  useEffect(() => {
    if (!isStreaming || !stream || !audioContextRef.current || 
        !isWebSocketReady || isAudioSetup || setupInProgressRef.current) return;

    let isActive = true;
    setupInProgressRef.current = true;

    const setupAudioProcessing = async () => {
      try {
        console.log("[Audio] Starting audio setup");
        const ctx = audioContextRef.current;
        if (!ctx || ctx.state === 'closed' || !isActive) {
          setupInProgressRef.current = false;
          return;
        }

        if (ctx.state === 'suspended') {
          await ctx.resume();
        }

        await ctx.audioWorklet.addModule('/worklets/audio-processor.js');

        if (!isActive) {
          setupInProgressRef.current = false;
          return;
        }

        audioWorkletNodeRef.current = new AudioWorkletNode(ctx, 'audio-processor', {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          processorOptions: {
            sampleRate: 16000,
            bufferSize: 2048,  // Reduced buffer size for faster response
          },
          channelCount: 1,
          channelCountMode: 'explicit',
          channelInterpretation: 'speakers'
        });

        const source = ctx.createMediaStreamSource(stream);
        audioWorkletNodeRef.current.port.onmessage = (event) => {
          if (!isActive || isModelSpeaking) return;
          const { pcmData, level } = event.data;
          setAudioLevel(level);
          console.log("[Audio] Level:", level);

          const pcmArray = new Uint8Array(pcmData);
          const b64Data = Base64.fromUint8Array(pcmArray);
          sendAudioData(b64Data);
        };

        source.connect(audioWorkletNodeRef.current);
        setIsAudioSetup(true);
        setupInProgressRef.current = false;
        console.log("[Audio] Setup complete");

        return () => {
          source.disconnect();
          if (audioWorkletNodeRef.current) {
            audioWorkletNodeRef.current.disconnect();
          }
          setIsAudioSetup(false);
        };
      } catch (error) {
        console.error("[Audio] Setup error:", error);
        if (isActive) {
          cleanupAudio();
          setIsAudioSetup(false);
        }
        setupInProgressRef.current = false;
      }
    };

    setupAudioProcessing();

    return () => {
      isActive = false;
      setIsAudioSetup(false);
      setupInProgressRef.current = false;
      if (audioWorkletNodeRef.current) {
        audioWorkletNodeRef.current.disconnect();
        audioWorkletNodeRef.current = null;
      }
    };
  }, [isStreaming, stream, isWebSocketReady, isModelSpeaking, cleanupAudio]);

  // Capture and send image
  const captureAndSendImage = () => {
    if (!videoRef.current || !videoCanvasRef.current || !geminiWsRef.current) return;

    const canvas = videoCanvasRef.current;
    const context = canvas.getContext('2d');
    if (!context) return;

    // Set canvas size to match video
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;

    // Draw video frame to canvas
    context.drawImage(videoRef.current, 0, 0);

    // Convert to base64 and send
    const imageData = canvas.toDataURL('image/jpeg', 0.8);
    const b64Data = imageData.split(',')[1];
    geminiWsRef.current.sendMediaChunk(b64Data, "image/jpeg");
  };

  const handleMathCanvasCapture = (imageData: string) => {
    if (!geminiWsRef.current || !isWebSocketReady) return;
    geminiWsRef.current.sendMediaChunk(imageData, "image/jpeg");
  };

  // Initialize RAG WebSocket when streaming starts
  useEffect(() => {
    if (!isStreaming) {
      ragService.disconnect();
      return;
    }

    if (inputMode === 'pdf') {
      ragService.connect();
      ragService.onMessage((text, audio) => {
        if (text) onTranscription(text);
        if (audio) {
          const audioData = Base64.decode(audio);
          // Handle audio playback if needed
        }
      });
    }
  }, [isStreaming, inputMode, onTranscription]);

  const stopStream = () => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      setStream(null);
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    if (audioWorkletNodeRef.current) {
      audioWorkletNodeRef.current.disconnect();
      audioWorkletNodeRef.current = null;
    }
    setIsStreaming(false);
  };

  const handleStreamingChange = (isStreaming: boolean) => {
    if (inputMode === 'pdf') {
      setIsStreaming(isStreaming);
      if (isStreaming) {
        startStream();
      } else {
        stopStream();
      }
    }
  };

  return (
    <div className="space-y-6">
      {/* Input Mode Toggle */}
      <div className="flex items-center justify-center p-2 bg-gradient-to-r from-slate-800 to-slate-900 rounded-xl shadow-inner">
        <div 
          className={`flex items-center justify-center space-x-3 rounded-lg py-1.5 px-4 cursor-pointer transition-colors ${inputMode === 'camera' ? 'text-white bg-slate-700' : 'text-gray-400 hover:text-gray-300'}`}
          onClick={() => {
            setInputMode('camera');
            if (isStreaming) startStream();
          }}
        >
          <CameraIcon className="h-5 w-5" />
          <span className="text-sm font-medium">Camera</span>
        </div>
        
        <div 
          className={`flex items-center justify-center space-x-3 rounded-lg py-1.5 px-4 mx-2 cursor-pointer transition-colors ${inputMode === 'screen' ? 'text-white bg-slate-700' : 'text-gray-400 hover:text-gray-300'}`}
          onClick={() => {
            setInputMode('screen');
            if (isStreaming) startStream();
          }}
        >
          <Monitor className="h-5 w-5" />
          <span className="text-sm font-medium">Screen</span>
        </div>

        <div 
          className={`flex items-center justify-center space-x-3 rounded-lg py-1.5 px-4 cursor-pointer transition-colors ${inputMode === 'math' ? 'text-white bg-slate-700' : 'text-gray-400 hover:text-gray-300'}`}
          onClick={() => {
            setInputMode('math');
            if (!isStreaming) setIsStreaming(true);
          }}
        >
          <PenTool className="h-5 w-5" />
          <span className="text-sm font-medium">Math</span>
        </div>

        <div 
          className={`flex items-center justify-center space-x-3 rounded-lg py-1.5 px-4 cursor-pointer transition-colors ${inputMode === 'pdf' ? 'text-white bg-slate-700' : 'text-gray-400 hover:text-gray-300'}`}
          onClick={() => {
            setInputMode('pdf');
            if (!isStreaming) setIsStreaming(true);
          }}
        >
          <FileText className="h-5 w-5" />
          <span className="text-sm font-medium">PDF</span>
        </div>
      </div>

      {/* Content Area */}
      {inputMode === 'pdf' ? (
        <>
          <PDFViewer onUploadSuccess={onTranscription} onStreamingChange={handleStreamingChange} />
          
          {/* Audio Level Indicator */}
          {isStreaming && (
            <div className="w-[640px] h-2.5 rounded-full bg-gray-200/10 overflow-hidden backdrop-blur-sm p-0.5">
              <div
                className="h-full rounded-full transition-all bg-gradient-to-r from-emerald-400 to-emerald-500 shadow-lg"
                style={{ 
                  width: `${isModelSpeaking ? outputAudioLevel : audioLevel}%`,
                  transition: 'all 150ms ease-out'
                }}
              />
            </div>
          )}
        </>
      ) : inputMode === 'math' ? (
        <>
          <MathCanvas onImageCapture={handleMathCanvasCapture} />
          
          {/* Audio Level Indicator */}
          {isStreaming && (
            <div className="w-[640px] h-2.5 rounded-full bg-gray-200/10 overflow-hidden backdrop-blur-sm p-0.5">
              <div
                className="h-full rounded-full transition-all bg-gradient-to-r from-emerald-400 to-emerald-500 shadow-lg"
                style={{ 
                  width: `${isModelSpeaking ? outputAudioLevel : audioLevel}%`,
                  transition: 'all 150ms ease-out'
                }}
              />
            </div>
          )}
        </>
      ) : (
        <>
          <div className="relative rounded-xl overflow-hidden shadow-2xl bg-gradient-to-b from-gray-900 to-gray-800 p-1">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              className="w-[640px] h-[480px] rounded-lg overflow-hidden object-cover bg-black/20"
            />
            
            {/* Connection Status Overlay */}
            {isStreaming && connectionStatus !== 'connected' && (
              <div className="absolute inset-0 bg-black/60 flex items-center justify-center rounded-lg backdrop-blur-sm transition-all duration-300">
                <div className="text-center space-y-3 px-6 py-4 bg-black/40 rounded-2xl backdrop-blur-md">
                  <div className="animate-spin rounded-full h-10 w-10 border-3 border-white border-t-transparent mx-auto" />
                  <p className="text-white font-semibold text-lg">
                    {connectionStatus === 'connecting' ? 'Connecting to Gemini...' : 'Disconnected'}
                  </p>
                  <p className="text-white/80 text-sm">
                    Please wait while we establish a secure connection
                  </p>
                </div>
              </div>
            )}

            {/* Control Buttons Container */}
            <div className="absolute bottom-6 left-0 right-0 flex justify-center items-center space-x-4">
              {/* Stream Toggle Button */}
              <Button
                onClick={toggleStream}
                size="icon"
                className={`rounded-full w-14 h-14 shadow-lg backdrop-blur-md transition-all duration-300 transform hover:scale-105
                  ${isStreaming 
                    ? 'bg-red-500/80 hover:bg-red-600/90 text-white' 
                    : 'bg-emerald-500/80 hover:bg-emerald-600/90 text-white'
                  }`}
              >
                {isStreaming ? 
                  <VideoOff className="h-7 w-7 transition-transform duration-200" /> : 
                  <Video className="h-7 w-7 transition-transform duration-200" />
                }
              </Button>

              {/* Front/Back Camera Toggle - Only show when in camera mode and streaming */}
              {isStreaming && inputMode === 'camera' && (
                <Button
                  onClick={toggleCameraFacing}
                  size="icon"
                  className="rounded-full w-14 h-14 bg-white/20 hover:bg-white/30 text-white shadow-lg backdrop-blur-md transition-all duration-300 transform hover:scale-105"
                >
                  <svg 
                    xmlns="http://www.w3.org/2000/svg" 
                    viewBox="0 0 24 24" 
                    fill="none" 
                    stroke="currentColor" 
                    strokeWidth="2.5" 
                    strokeLinecap="round" 
                    strokeLinejoin="round" 
                    className="h-7 w-7 transition-transform duration-200"
                  >
                    <path d="M16 3h5v5" />
                    <path d="M8 21H3v-5" />
                    <path d="M21 3l-7 7" />
                    <path d="M3 21l7-7" />
                  </svg>
                </Button>
              )}
            </div>
          </div>

          {/* Audio Level Indicator */}
          {isStreaming && (
            <div className="w-[640px] h-2.5 rounded-full bg-gray-200/10 overflow-hidden backdrop-blur-sm p-0.5">
              <div
                className="h-full rounded-full transition-all bg-gradient-to-r from-emerald-400 to-emerald-500 shadow-lg"
                style={{ 
                  width: `${isModelSpeaking ? outputAudioLevel : audioLevel}%`,
                  transition: 'all 150ms ease-out'
                }}
              />
            </div>
          )}
          <canvas ref={videoCanvasRef} className="hidden" />
        </>
      )}
    </div>
  );
}
