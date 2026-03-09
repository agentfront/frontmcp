import React from 'react';
import { styled } from '@mui/material/styles';
import MuiTable from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Paper from '@mui/material/Paper';

export interface TableColumn {
  key: string;
  label: string;
  align?: 'left' | 'center' | 'right';
}

export interface TableProps {
  columns: TableColumn[];
  rows: Record<string, unknown>[];
  size?: 'small' | 'medium';
  stickyHeader?: boolean;
  maxHeight?: number;
}

const StyledHeaderCell = styled(TableCell, {
  name: 'Table',
  slot: 'HeaderCell',
})(({ theme }) => ({
  fontWeight: 600,
  backgroundColor: theme.palette.mode === 'dark' ? theme.palette.grey[900] : theme.palette.grey[50],
}));

const StyledBodyCell = styled(TableCell, {
  name: 'Table',
  slot: 'BodyCell',
})({});

export function Table({
  columns,
  rows,
  size = 'small',
  stickyHeader = false,
  maxHeight,
}: TableProps): React.ReactElement {
  return (
    <TableContainer component={Paper} variant="outlined" sx={maxHeight ? { maxHeight } : undefined}>
      <MuiTable size={size} stickyHeader={stickyHeader}>
        <TableHead>
          <TableRow>
            {columns.map((col) => (
              <StyledHeaderCell key={col.key} align={col.align ?? 'left'}>
                {col.label}
              </StyledHeaderCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row, idx) => (
            <TableRow key={idx} hover>
              {columns.map((col) => (
                <StyledBodyCell key={col.key} align={col.align ?? 'left'}>
                  {String(row[col.key] ?? '')}
                </StyledBodyCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </MuiTable>
    </TableContainer>
  );
}
