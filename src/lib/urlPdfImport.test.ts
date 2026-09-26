import { describe, expect, it } from 'vitest';
import {
  classifyUrlPdfResponse,
  permissionPattern,
  urlPdfRejectionMessage,
} from './urlPdfImport';

const bytes = (value: string): Uint8Array => new TextEncoder().encode(value);

describe('URL PDF import boundary', () => {
  it('accepts only a real PDF signature, regardless of a misleading URL or header supplied elsewhere', () => {
    expect(classifyUrlPdfResponse(bytes('%PDF-1.7\nbody'))).toBe('pdf');
    expect(classifyUrlPdfResponse(bytes('paper.pdf is only a filename'))).toBe('not-pdf');
  });

  it('rejects an HTML paper or sign-in page even when it could be presented as a PDF response', () => {
    expect(classifyUrlPdfResponse(bytes(' \ufeff<!DOCTYPE HTML><html><body>paper</body></html>'))).toBe('html');
    expect(urlPdfRejectionMessage('html')).toContain('returned HTML instead of a PDF');
  });

  it('keeps non-HTML non-PDF responses distinct for a useful error', () => {
    expect(classifyUrlPdfResponse(bytes('{"error":"not found"}'))).toBe('not-pdf');
    expect(urlPdfRejectionMessage('not-pdf')).toContain('not a PDF');
  });

  it('requests only the submitted HTTPS host, never a path or a port-specific permission', () => {
    expect(permissionPattern(new URL('https://papers.example.edu:8443/download?id=42'))).toBe('https://papers.example.edu/*');
  });
});
