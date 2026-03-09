import React, { useState, useMemo, useCallback } from 'react';
import Box from '@mui/material/Box';
import MuiTable from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TablePagination from '@mui/material/TablePagination';
import TableSortLabel from '@mui/material/TableSortLabel';
import TextField from '@mui/material/TextField';
import { styled } from '@mui/material/styles';
import type { ContentRenderer, RenderOptions } from '../types';

// ============================================
// CSV Parsing (kept from original)
// ============================================

export function detectDelimiter(content: string): string {
  const firstLine = content.split('\n')[0];
  const commas = (firstLine.match(/,/g) ?? []).length;
  const tabs = (firstLine.match(/\t/g) ?? []).length;
  const semicolons = (firstLine.match(/;/g) ?? []).length;

  if (tabs > commas && tabs > semicolons) return '\t';
  if (semicolons > commas) return ';';
  return ',';
}

export function parseCsv(content: string, delimiter: string): string[][] {
  return content
    .trim()
    .split('\n')
    .map((line) => line.split(delimiter).map((cell) => cell.trim()));
}

// ============================================
// Styled Components
// ============================================

const CsvRoot = styled(Box, {
  name: 'FrontMcpCsvTable',
  slot: 'Root',
})({
  width: '100%',
});

const StyledHeaderCell = styled(TableCell, {
  name: 'FrontMcpCsvTable',
  slot: 'Header',
})(({ theme }) => ({
  fontWeight: 600,
  backgroundColor: theme.palette.mode === 'dark' ? theme.palette.grey[900] : theme.palette.grey[50],
  whiteSpace: 'nowrap',
}));

const FilterToolbar = styled(Box, {
  name: 'FrontMcpCsvTable',
  slot: 'Toolbar',
})(({ theme }) => ({
  padding: theme.spacing(1, 2),
  display: 'flex',
  gap: theme.spacing(1),
}));

// ============================================
// Types
// ============================================

type SortDirection = 'asc' | 'desc';

// ============================================
// Component
// ============================================

interface CsvTableProps {
  content: string;
  className?: string;
  pageSize?: number;
}

function CsvTableView({ content, className, pageSize = 25 }: CsvTableProps): React.ReactElement {
  const delimiter = useMemo(() => detectDelimiter(content), [content]);
  const allRows = useMemo(() => parseCsv(content, delimiter), [content, delimiter]);

  const headers = allRows[0] ?? [];
  const dataRows = useMemo(() => allRows.slice(1), [allRows]);

  // State
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(pageSize);
  const [sortCol, setSortCol] = useState<number | null>(null);
  const [sortDir, setSortDir] = useState<SortDirection>('asc');
  const [filter, setFilter] = useState('');

  // Filter
  const filteredRows = useMemo(() => {
    if (!filter) return dataRows;
    const lower = filter.toLowerCase();
    return dataRows.filter((row) => row.some((cell) => cell.toLowerCase().includes(lower)));
  }, [dataRows, filter]);

  // Sort
  const sortedRows = useMemo(() => {
    if (sortCol === null) return filteredRows;
    const sorted = [...filteredRows];
    sorted.sort((a, b) => {
      const va = a[sortCol] ?? '';
      const vb = b[sortCol] ?? '';
      const numA = Number(va);
      const numB = Number(vb);
      if (!isNaN(numA) && !isNaN(numB)) {
        return sortDir === 'asc' ? numA - numB : numB - numA;
      }
      return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
    });
    return sorted;
  }, [filteredRows, sortCol, sortDir]);

  // Paginate
  const pageRows = useMemo(
    () => sortedRows.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage),
    [sortedRows, page, rowsPerPage],
  );

  const handleSort = useCallback((colIndex: number) => {
    setSortCol((prev) => {
      if (prev === colIndex) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
        return colIndex;
      }
      setSortDir('asc');
      return colIndex;
    });
  }, []);

  const handleChangePage = useCallback((_: unknown, newPage: number) => setPage(newPage), []);
  const handleChangeRowsPerPage = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setRowsPerPage(parseInt(e.target.value, 10));
    setPage(0);
  }, []);

  return React.createElement(
    CsvRoot,
    { className },
    React.createElement(
      FilterToolbar,
      null,
      React.createElement(TextField, {
        size: 'small',
        placeholder: 'Filter rows...',
        value: filter,
        onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
          setFilter(e.target.value);
          setPage(0);
        },
        sx: { minWidth: 200 },
      }),
    ),
    React.createElement(
      TableContainer,
      { sx: { border: 1, borderColor: 'divider', borderRadius: 1 } } as Record<string, unknown>,
      React.createElement(
        MuiTable,
        { size: 'small', stickyHeader: true },
        React.createElement(
          TableHead,
          null,
          React.createElement(
            TableRow,
            null,
            headers.map((header, i) =>
              React.createElement(
                StyledHeaderCell,
                { key: i },
                React.createElement(
                  TableSortLabel,
                  {
                    active: sortCol === i,
                    direction: sortCol === i ? sortDir : 'asc',
                    onClick: () => handleSort(i),
                  },
                  header,
                ),
              ),
            ),
          ),
        ),
        React.createElement(
          TableBody,
          null,
          pageRows.map((row, ri) =>
            React.createElement(
              TableRow,
              { key: ri, hover: true },
              row.map((cell, ci) => React.createElement(TableCell, { key: ci }, cell)),
            ),
          ),
        ),
      ),
    ),
    sortedRows.length > rowsPerPage &&
      React.createElement(TablePagination, {
        count: sortedRows.length,
        page,
        rowsPerPage,
        onPageChange: handleChangePage,
        onRowsPerPageChange: handleChangeRowsPerPage,
        rowsPerPageOptions: [10, 25, 50, 100],
      }),
  );
}

// ============================================
// Renderer
// ============================================

export class CsvRenderer implements ContentRenderer {
  readonly type = 'csv';
  readonly priority = 10;

  canHandle(content: string): boolean {
    const lines = content.trim().split('\n').slice(0, 5);
    if (lines.length < 2) return false;

    for (const delim of [',', '\t', ';']) {
      const counts = lines.map((line) => line.split(delim).length);
      if (counts[0] > 1 && counts.every((c) => c === counts[0])) return true;
    }
    return false;
  }

  render(content: string, options?: RenderOptions): React.ReactElement {
    const pageSize = options?.rendererOptions?.['pageSize'] as number | undefined;
    return React.createElement(CsvTableView, {
      content,
      className: options?.className ?? 'fmcp-csv-table',
      pageSize,
    });
  }
}

export const csvRenderer = new CsvRenderer();
