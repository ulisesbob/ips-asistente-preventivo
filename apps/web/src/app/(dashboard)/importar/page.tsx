'use client';

import { useRef, useState, useCallback } from 'react';
import { apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Upload,
  UploadCloud,
  FileText,
  CheckCircle2,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Loader2,
  X,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

type ViewState = 'upload' | 'preview' | 'result';

interface ParsedRow {
  rowNumber: number;
  fullName: string;
  dni: string;
  phone: string;
  birthDate: string;
  gender: string;
  errors: string[];
}

interface ImportResponse {
  created: number;
  updated: number;
  total: number;
}

interface ImportError {
  status: 'error';
  message: string;
  errors?: Record<string, { errors: string[] }>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseCSV(text: string): ParsedRow[] {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  const headers = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const nameIdx = headers.indexOf('fullname');
  const dniIdx = headers.indexOf('dni');
  const phoneIdx = headers.indexOf('phone');
  const birthIdx = headers.indexOf('birthdate');
  const genderIdx = headers.indexOf('gender');

  const rows: ParsedRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const cols = line.split(',').map((c) => c.trim());
    const errors: string[] = [];

    const fullName = nameIdx >= 0 ? cols[nameIdx] || '' : '';
    const dni = dniIdx >= 0 ? cols[dniIdx] || '' : '';
    const phone = phoneIdx >= 0 ? cols[phoneIdx] || '' : '';
    const birthDate = birthIdx >= 0 ? cols[birthIdx] || '' : '';
    const gender = genderIdx >= 0 ? cols[genderIdx] || '' : '';

    if (!fullName) errors.push('Nombre requerido');
    if (!dni) {
      errors.push('DNI requerido');
    } else if (!/^\d{7,8}$/.test(dni)) {
      errors.push('DNI debe tener 7-8 dígitos');
    }
    if (phone && !/^\+\d{10,15}$/.test(phone)) {
      errors.push('Teléfono debe estar en formato E.164 (ej: +5493001234567)');
    }
    if (birthDate && !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) {
      errors.push('Fecha debe ser YYYY-MM-DD');
    }
    if (gender && !['M', 'F', 'OTRO'].includes(gender.toUpperCase())) {
      errors.push('Género debe ser M, F u OTRO');
    }

    rows.push({ rowNumber: i, fullName, dni, phone, birthDate, gender, errors });
  }

  return rows;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function ImportarPage() {
  const { doctor } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [view, setView] = useState<ViewState>('upload');
  const [fileName, setFileName] = useState('');
  const [rawCSV, setRawCSV] = useState('');
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResponse | null>(null);
  const [apiError, setApiError] = useState<ImportError | null>(null);
  const [showErrors, setShowErrors] = useState(false);

  // ── Access guard ──────────────────────────────────────────────────────────

  if (doctor && doctor.role !== 'ADMIN') {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <p className="text-sm text-muted-foreground">
          Solo los administradores pueden importar pacientes.
        </p>
      </div>
    );
  }

  // ── File handling ─────────────────────────────────────────────────────────

  const handleFile = (file: File) => {
    if (!file.name.endsWith('.csv')) return;
    if (file.size > 500 * 1024) {
      alert('El archivo excede el límite de 500KB.');
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      setRawCSV(text);
      setFileName(file.name);
      setRows(parseCSV(text));
      setView('preview');
    };
    reader.readAsText(file);
  };

  // ── Drag & drop ───────────────────────────────────────────────────────────

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files?.[0];
      if (file) handleFile(file);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = '';
  };

  // ── Import ────────────────────────────────────────────────────────────────

  const validRows = rows.filter((r) => r.errors.length === 0);
  const errorRows = rows.filter((r) => r.errors.length > 0);

  const handleImport = async () => {
    if (validRows.length === 0) return;
    setImporting(true);
    setApiError(null);

    try {
      const res = await apiPost<ImportResponse>('/api/patients/import', {
        csvContent: rawCSV,
      });
      setResult(res);
      setView('result');
    } catch (err: unknown) {
      const error = err as ImportError;
      setApiError(error);
      setView('result');
    } finally {
      setImporting(false);
    }
  };

  const resetAll = () => {
    setView('upload');
    setFileName('');
    setRawCSV('');
    setRows([]);
    setResult(null);
    setApiError(null);
    setShowErrors(false);
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-foreground flex items-center gap-2">
          <Upload className="w-5 h-5" />
          Importar Pacientes
        </h1>
      </div>

      {/* ── State 1: Upload ──────────────────────────────────────────────── */}
      {view === 'upload' && (
        <>
          {/* Info card */}
          <div className="bg-white rounded-lg border border-border p-4">
            <h2 className="text-sm font-medium text-foreground mb-2">
              Formato del archivo CSV
            </h2>
            <div className="text-sm text-muted-foreground space-y-1.5">
              <p>
                <span className="font-medium text-foreground">Columnas requeridas:</span>{' '}
                fullName, dni
              </p>
              <p>
                <span className="font-medium text-foreground">Columnas opcionales:</span>{' '}
                phone (E.164, ej: +5493001234567), birthDate (YYYY-MM-DD), gender (M/F/OTRO)
              </p>
              <div className="mt-3 bg-slate-50 rounded-md p-3 font-mono text-xs overflow-x-auto">
                <p className="text-muted-foreground">fullName,dni,phone,birthDate,gender</p>
                <p>María García,28456789,+5493001234567,1985-03-15,F</p>
                <p>Juan Pérez,30123456,,,M</p>
              </div>
            </div>
          </div>

          {/* Drag & drop zone */}
          <div
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`
              bg-white rounded-lg border-2 border-dashed cursor-pointer
              flex flex-col items-center justify-center py-20 px-6
              transition-colors
              ${
                isDragging
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:border-muted-foreground/40'
              }
            `}
          >
            <UploadCloud
              className={`w-10 h-10 mb-3 ${
                isDragging ? 'text-primary' : 'text-muted-foreground/50'
              }`}
            />
            <p className="text-sm text-foreground font-medium mb-1">
              Arrastrá tu archivo CSV aquí
            </p>
            <p className="text-xs text-muted-foreground">
              o{' '}
              <span className="text-primary underline underline-offset-2">
                seleccioná un archivo
              </span>
            </p>
            <p className="text-xs text-muted-foreground mt-2">
              Máximo 500KB
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              onChange={onFileChange}
              className="hidden"
            />
          </div>
        </>
      )}

      {/* ── State 2: Preview ─────────────────────────────────────────────── */}
      {view === 'preview' && (
        <>
          {/* File info */}
          <div className="bg-white rounded-lg border border-border p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <FileText className="w-5 h-5 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium text-foreground">{fileName}</p>
                <p className="text-xs text-muted-foreground">
                  {rows.length} {rows.length === 1 ? 'fila' : 'filas'} detectadas
                </p>
              </div>
            </div>
            <button
              onClick={resetAll}
              className="p-1.5 rounded-md text-muted-foreground hover:bg-accent transition-colors"
              aria-label="Cerrar archivo"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Validation summary */}
          <div className="flex items-center gap-3">
            {validRows.length > 0 && (
              <Badge
                variant="secondary"
                className="bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-50"
              >
                {validRows.length} {validRows.length === 1 ? 'fila válida' : 'filas válidas'}
              </Badge>
            )}
            {errorRows.length > 0 && (
              <Badge
                variant="secondary"
                className="bg-red-50 text-red-700 border border-red-200 hover:bg-red-50"
              >
                {errorRows.length} con errores
              </Badge>
            )}
          </div>

          {/* Info: server-side validation */}
          <p className="text-xs text-muted-foreground">
            La vista previa es orientativa. La validación final (DNI duplicados, formato de teléfono) se realiza en el servidor al importar.
          </p>

          {/* Preview table */}
          <div className="bg-white rounded-lg border border-border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border bg-slate-50/50">
                    <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3 w-12">
                      #
                    </th>
                    <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">
                      Nombre
                    </th>
                    <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">
                      DNI
                    </th>
                    <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">
                      Teléfono
                    </th>
                    <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">
                      Nacimiento
                    </th>
                    <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">
                      Género
                    </th>
                    <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">
                      Estado
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.slice(0, 10).map((row) => (
                    <tr
                      key={row.rowNumber}
                      className={
                        row.errors.length > 0
                          ? 'bg-red-50/40'
                          : 'hover:bg-slate-50/50 transition-colors'
                      }
                    >
                      <td className="px-4 py-3 text-xs text-muted-foreground tabular-nums">
                        {row.rowNumber}
                      </td>
                      <td className="px-4 py-3 text-sm text-foreground">
                        {row.fullName || (
                          <span className="text-red-400 italic">vacío</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-muted-foreground tabular-nums">
                        {row.dni || (
                          <span className="text-red-400 italic">vacío</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-muted-foreground">
                        {row.phone || '—'}
                      </td>
                      <td className="px-4 py-3 text-sm text-muted-foreground tabular-nums">
                        {row.birthDate || '—'}
                      </td>
                      <td className="px-4 py-3 text-sm text-muted-foreground">
                        {row.gender || '—'}
                      </td>
                      <td className="px-4 py-3">
                        {row.errors.length > 0 ? (
                          <div className="space-y-0.5">
                            {row.errors.map((err, idx) => (
                              <p
                                key={idx}
                                className="text-xs text-red-600 flex items-center gap-1"
                              >
                                <AlertCircle className="w-3 h-3 shrink-0" />
                                {err}
                              </p>
                            ))}
                          </div>
                        ) : (
                          <span className="inline-flex text-xs px-2 py-0.5 rounded border bg-emerald-50 text-emerald-700 border-emerald-200">
                            OK
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {rows.length > 10 && (
              <div className="px-4 py-3 border-t border-border text-center">
                <p className="text-xs text-muted-foreground">
                  Mostrando 10 de {rows.length} filas. Todas las filas serán procesadas al importar.
                </p>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3">
            <Button variant="outline" onClick={resetAll}>
              Cancelar
            </Button>
            <Button
              onClick={handleImport}
              disabled={validRows.length === 0 || importing}
            >
              {importing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Importando...
                </>
              ) : (
                <>
                  Importar {validRows.length}{' '}
                  {validRows.length === 1 ? 'paciente' : 'pacientes'}
                </>
              )}
            </Button>
          </div>
        </>
      )}

      {/* ── State 3: Result ──────────────────────────────────────────────── */}
      {view === 'result' && (
        <>
          {result && !apiError && (
            <div className="bg-white rounded-lg border border-border p-8 flex flex-col items-center text-center">
              <div className="w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center mb-4">
                <CheckCircle2 className="w-6 h-6 text-emerald-600" />
              </div>
              <h2 className="text-lg font-semibold text-foreground mb-1">
                Importación completada
              </h2>
              <p className="text-sm text-muted-foreground mb-6">
                Se procesaron los pacientes correctamente.
              </p>

              <div className="flex items-center gap-6 mb-6">
                <div className="text-center">
                  <p className="text-2xl font-bold text-foreground tabular-nums">
                    {result.created}
                  </p>
                  <p className="text-xs text-muted-foreground">Creados</p>
                </div>
                <div className="w-px h-10 bg-border" />
                <div className="text-center">
                  <p className="text-2xl font-bold text-foreground tabular-nums">
                    {result.updated}
                  </p>
                  <p className="text-xs text-muted-foreground">Actualizados</p>
                </div>
                <div className="w-px h-10 bg-border" />
                <div className="text-center">
                  <p className="text-2xl font-bold text-foreground tabular-nums">
                    {result.total}
                  </p>
                  <p className="text-xs text-muted-foreground">Total</p>
                </div>
              </div>

              <Button onClick={resetAll}>Importar otro archivo</Button>
            </div>
          )}

          {apiError && (
            <div className="bg-white rounded-lg border border-border p-8 flex flex-col items-center text-center">
              <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mb-4">
                <AlertCircle className="w-6 h-6 text-red-600" />
              </div>
              <h2 className="text-lg font-semibold text-foreground mb-1">
                Error en la importación
              </h2>
              <p className="text-sm text-muted-foreground mb-6">
                {apiError.message || 'Ocurrió un error al procesar el archivo.'}
              </p>

              {apiError.errors && Object.keys(apiError.errors).length > 0 && (
                <div className="w-full max-w-lg mb-6">
                  <button
                    onClick={() => setShowErrors(!showErrors)}
                    className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mx-auto"
                  >
                    {showErrors ? (
                      <ChevronUp className="w-4 h-4" />
                    ) : (
                      <ChevronDown className="w-4 h-4" />
                    )}
                    Ver detalles de errores ({Object.keys(apiError.errors).length})
                  </button>

                  {showErrors && (
                    <div className="mt-3 bg-slate-50 rounded-md border border-border p-4 text-left max-h-60 overflow-y-auto">
                      {Object.entries(apiError.errors).map(([key, val]) => (
                        <div key={key} className="mb-2 last:mb-0">
                          <p className="text-xs font-medium text-foreground">
                            Fila {key}
                          </p>
                          {val.errors.map((err, idx) => (
                            <p key={idx} className="text-xs text-red-600 ml-3">
                              - {err}
                            </p>
                          ))}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <Button onClick={resetAll}>Importar otro archivo</Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
