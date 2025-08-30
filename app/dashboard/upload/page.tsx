'use client';

import { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Upload, FileSpreadsheet, AlertCircle, CheckCircle2, X } from 'lucide-react';
import { toast } from 'sonner';

export default function UploadPage() {
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadResult, setUploadResult] = useState<any>(null);
  const [progressMessage, setProgressMessage] = useState('');

  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      const uploadedFile = acceptedFiles[0];
      const validExtensions = ['.xlsx', '.xls', '.csv'];
      const fileExtension = uploadedFile.name.substring(uploadedFile.name.lastIndexOf('.')).toLowerCase();
      
      if (validExtensions.includes(fileExtension)) {
        setFile(uploadedFile);
        setUploadResult(null);
      } else {
        toast.error('Invalid file format. Please upload Excel (.xlsx, .xls) or CSV file.');
      }
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
      'application/vnd.ms-excel': ['.xls'],
      'text/csv': ['.csv'],
    },
    maxFiles: 1,
  });

  const handleUpload = async () => {
    if (!file) {
      toast.error('Please select a file');
      return;
    }

    setIsUploading(true);
    setUploadProgress(0);
    setUploadResult(null);
    setProgressMessage('Initializing upload...');

    const formData = new FormData();
    formData.append('file', file);
    // Date will be extracted from Excel file automatically

    try {
      // Use streaming endpoint for real-time progress
      const response = await fetch('/api/upload/stream', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error('Upload failed');
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) {
        throw new Error('No response body');
      }

      let buffer = '';
      
      while (true) {
        const { done, value } = await reader.read();
        
        if (done) break;
        
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              
              // Update progress based on message type
              switch (data.type) {
                case 'start':
                  setProgressMessage(data.message);
                  setUploadProgress(5);
                  break;
                case 'parsing':
                  setProgressMessage(data.message);
                  setUploadProgress(10);
                  break;
                case 'parsed':
                  setProgressMessage(data.message);
                  setUploadProgress(15);
                  break;
                case 'checking':
                  setProgressMessage(data.message);
                  setUploadProgress(20);
                  break;
                case 'inserting_shareholders':
                  setProgressMessage(data.message);
                  setUploadProgress(25);
                  break;
                case 'progress_shareholders':
                  setProgressMessage(data.message);
                  setUploadProgress(25 + (data.percentage * 0.25));
                  break;
                case 'preparing':
                  setProgressMessage(data.message);
                  setUploadProgress(50);
                  break;
                case 'cleaning':
                  setProgressMessage(data.message);
                  setUploadProgress(55);
                  break;
                case 'inserting_holdings':
                  setProgressMessage(data.message);
                  setUploadProgress(60);
                  break;
                case 'progress_holdings':
                  setProgressMessage(data.message);
                  setUploadProgress(60 + (data.percentage * 0.35));
                  break;
                case 'finalizing':
                  setProgressMessage(data.message);
                  setUploadProgress(95);
                  break;
                case 'complete':
                  setProgressMessage('Upload complete!');
                  setUploadProgress(100);
                  setUploadResult({
                    success: true,
                    message: data.message,
                    uploadId: data.uploadId,
                    processedCount: data.processedCount,
                    errorCount: data.errorCount,
                    errors: data.errors,
                  });
                  toast.success(data.message);
                  setFile(null);
                  setTimeout(() => {
                    setProgressMessage('');
                    setUploadProgress(0);
                  }, 2000);
                  break;
                case 'info':
                  setProgressMessage(data.message);
                  break;
                case 'error':
                  setProgressMessage(`Error: ${data.message}`);
                  toast.error(data.message);
                  if (data.error) {
                    console.error('Upload error:', data.error);
                  }
                  break;
              }
            } catch (e) {
              console.error('Failed to parse SSE message:', e);
            }
          }
        }
      }
    } catch (error) {
      console.error('Upload error:', error);
      toast.error('Failed to upload file');
      setProgressMessage('');
      setUploadProgress(0);
    } finally {
      setIsUploading(false);
    }
  };

  const removeFile = () => {
    setFile(null);
    setUploadResult(null);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Upload Data</h1>
        <p className="text-gray-600">Upload shareholder data from Excel or CSV files</p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>File Upload</CardTitle>
            <CardDescription>
              Drag and drop your file here or click to browse
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">

            <div
              {...getRootProps()}
              className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors
                ${isDragActive ? 'border-primary bg-primary/10' : 'border-gray-300 hover:border-gray-400'}
                ${isUploading ? 'opacity-50 cursor-not-allowed' : ''}
              `}
            >
              <input {...getInputProps()} disabled={isUploading} />
              
              {file ? (
                <div className="space-y-2">
                  <FileSpreadsheet className="h-12 w-12 mx-auto text-green-600" />
                  <div className="flex items-center justify-center gap-2">
                    <p className="text-sm font-medium">{file.name}</p>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        removeFile();
                      }}
                      className="text-red-500 hover:text-red-700"
                      disabled={isUploading}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  <p className="text-xs text-gray-500">
                    {(file.size / 1024).toFixed(2)} KB
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  <Upload className="h-12 w-12 mx-auto text-gray-400" />
                  <p className="text-sm text-gray-600">
                    {isDragActive ? 'Drop the file here' : 'Drag & drop file here, or click to select'}
                  </p>
                  <p className="text-xs text-gray-500">
                    Supports: Excel (.xlsx, .xls) and CSV files
                  </p>
                </div>
              )}
            </div>

            {isUploading && (
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="font-medium">{progressMessage || 'Processing...'}</span>
                  <span className="font-bold">{uploadProgress}%</span>
                </div>
                <Progress value={uploadProgress} className="h-2" />
                {progressMessage && progressMessage.includes('of') && (
                  <p className="text-xs text-gray-500 text-center">{progressMessage}</p>
                )}
              </div>
            )}

            <Button
              onClick={handleUpload}
              disabled={!file || isUploading}
              className="w-full"
            >
              {isUploading ? 'Processing...' : 'Upload File'}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Upload Guidelines</CardTitle>
            <CardDescription>
              Please ensure your file follows these guidelines
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-3">
              <h4 className="font-medium">Required Columns:</h4>
              <ul className="space-y-1 text-sm text-gray-600">
                <li>• Nama / Name - Shareholder name</li>
                <li>• Jumlah Saham / Shares - Number of shares</li>
                <li>• % / Percentage - Ownership percentage</li>
                <li>• Nama Pemegang Rekening - Account holder (optional)</li>
              </ul>
            </div>

            <div className="space-y-3">
              <h4 className="font-medium">File Requirements:</h4>
              <ul className="space-y-1 text-sm text-gray-600">
                <li>• Maximum file size: 10MB</li>
                <li>• Supported formats: .xlsx, .xls, .csv</li>
                <li>• Multiple sheets supported in Excel files</li>
                <li>• Date will be auto-extracted from row 3</li>
                <li>• Header row should contain column names</li>
              </ul>
            </div>

            {uploadResult && (
              <Alert className={uploadResult.errorCount > 0 ? 'border-yellow-200' : 'border-green-200'}>
                {uploadResult.errorCount > 0 ? (
                  <AlertCircle className="h-4 w-4 text-yellow-600" />
                ) : (
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                )}
                <AlertDescription>
                  <div className="space-y-2">
                    <p className="font-medium">Upload Complete</p>
                    <p className="text-sm">
                      Processed: {uploadResult.processedCount} records
                    </p>
                    {uploadResult.errorCount > 0 && (
                      <>
                        <p className="text-sm text-yellow-600">
                          Errors: {uploadResult.errorCount}
                        </p>
                        {uploadResult.errors?.length > 0 && (
                          <div className="mt-2 text-xs space-y-1">
                            {uploadResult.errors.slice(0, 3).map((error: string, i: number) => (
                              <p key={i} className="text-gray-600">• {error}</p>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}