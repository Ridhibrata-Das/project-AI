"use client";

import { useRef, useState, useEffect } from 'react';
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { FileText, AlertCircle, Play, StopCircle } from 'lucide-react';
import { RAGService } from '../services/ragService';

interface PDFViewerProps {
  onUploadSuccess: (message: string) => void;
  onStreamingChange: (isStreaming: boolean) => void;
}

export default function PDFViewer({ onUploadSuccess, onStreamingChange }: PDFViewerProps) {
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const ragService = RAGService.getInstance();

  useEffect(() => {
    // Cleanup on unmount
    return () => {
      if (isStreaming) {
        ragService.disconnect();
      }
    };
  }, [isStreaming]);

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      setError('No file selected');
      return;
    }

    if (!file.type.includes('pdf')) {
      setError('Please select a valid PDF file');
      return;
    }

    if (file.size > 10 * 1024 * 1024) { // 10MB limit
      setError('File size too large. Please select a PDF under 10MB');
      return;
    }

    try {
      setError(null);
      setIsUploading(true);
      setConnectionStatus('connecting');

      // Create object URL for preview
      const url = URL.createObjectURL(file);
      setPdfUrl(url);

      // Upload to RAG service
      await ragService.uploadPDF(file);
      setConnectionStatus('connected');
      onUploadSuccess(`PDF file ${file.name} has been uploaded and indexed successfully.`);
    } catch (error) {
      console.error('Error uploading PDF:', error);
      setError(error instanceof Error ? error.message : 'Failed to upload PDF file. Please try again.');
      setConnectionStatus('disconnected');
    } finally {
      setIsUploading(false);
    }
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const toggleStreaming = async () => {
    try {
      if (isStreaming) {
        ragService.disconnect();
        setIsStreaming(false);
        onStreamingChange(false);
      } else {
        await ragService.connect();
        setIsStreaming(true);
        onStreamingChange(true);
      }
    } catch (error) {
      console.error('Error toggling stream:', error);
      setError('Failed to connect to RAG server. Please ensure the server is running on port 9084.');
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Input
          ref={fileInputRef}
          type="file"
          accept="application/pdf"
          onChange={handleFileChange}
          className="hidden"
          disabled={isUploading}
        />
        <Button
          onClick={handleUploadClick}
          variant="outline"
          className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700"
          disabled={isUploading}
        >
          <FileText className="h-4 w-4" />
          <span>{isUploading ? 'Uploading...' : 'RAG PDF'}</span>
        </Button>

        {connectionStatus === 'connected' && (
          <Button
            onClick={toggleStreaming}
            variant="outline"
            className={`flex items-center gap-2 ${
              isStreaming ? 'bg-red-600 hover:bg-red-700' : 'bg-green-600 hover:bg-green-700'
            }`}
          >
            {isStreaming ? (
              <>
                <StopCircle className="h-4 w-4" />
                <span>Stop Gemini</span>
              </>
            ) : (
              <>
                <Play className="h-4 w-4" />
                <span>Start Gemini</span>
              </>
            )}
          </Button>
        )}
      </div>

      {error && (
        <div className="flex items-center gap-2 text-red-500 text-sm">
          <AlertCircle className="h-4 w-4" />
          <span>{error}</span>
        </div>
      )}

      {connectionStatus === 'connecting' && (
        <div className="text-yellow-500 text-sm">
          Connecting to RAG server...
        </div>
      )}

      {pdfUrl && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-8">
          <div className="bg-white rounded-lg shadow-xl overflow-hidden max-w-4xl w-full">
            <div className="flex justify-between items-center p-4 border-b">
              <h3 className="text-lg font-semibold">PDF Preview</h3>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setPdfUrl(null)}
              >
                ✕
              </Button>
            </div>
            <embed
              src={pdfUrl}
              type="application/pdf"
              className="w-full h-[80vh]"
            />
          </div>
        </div>
      )}
    </div>
  );
} 