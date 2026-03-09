import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';
import { SALARY_BANDS } from '../data/employees';

const inputSchema = {
  candidateName: z.string().describe('Full name of the candidate'),
  role: z.string().describe('Job title for the offer'),
  department: z.string().describe('Department the candidate will join'),
  salaryBand: z.string().describe('Salary band (e.g. IC1, IC2, IC3, IC4, M1, M2, E1)'),
  startDate: z.string().describe('Proposed start date (YYYY-MM-DD)'),
};

const outputSchema = z
  .object({
    candidateName: z.string(),
    role: z.string(),
    salaryRange: z.string(),
  })
  .strict();

type Input = z.infer<z.ZodObject<typeof inputSchema>>;
type Output = z.infer<typeof outputSchema>;

function buildPdf(name: string, role: string, department: string, salaryRange: string, startDate: string): string {
  const lines = [
    'OFFER LETTER',
    '',
    `Date: ${new Date().toISOString().split('T')[0]}`,
    '',
    `Dear ${name},`,
    '',
    `We are pleased to offer you the position of ${role}`,
    `in our ${department} department.`,
    '',
    `Compensation: ${salaryRange}`,
    `Start Date: ${startDate}`,
    '',
    'This offer is contingent upon successful completion',
    'of background verification.',
    '',
    'We look forward to welcoming you to the team!',
    '',
    'Best regards,',
    'ACME Corp - People Ops',
  ];

  const textContent = lines.join('\n');

  const streamLines: string[] = [];
  let yPos = 750;
  for (const line of lines) {
    if (line === '') {
      yPos -= 18;
      continue;
    }
    const escaped = line.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
    streamLines.push(`BT /F1 12 Tf 72 ${yPos} Td (${escaped}) Tj ET`);
    yPos -= 18;
  }
  const streamContent = streamLines.join('\n');

  const objects: string[] = [];
  const offsets: number[] = [];
  let pos = 0;

  const header = '%PDF-1.4\n';
  pos = header.length;

  // Object 1: Catalog
  offsets.push(pos);
  const obj1 = '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n';
  pos += obj1.length;

  // Object 2: Pages
  offsets.push(pos);
  const obj2 = '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n';
  pos += obj2.length;

  // Object 3: Page
  offsets.push(pos);
  const obj3 =
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n';
  pos += obj3.length;

  // Object 4: Content stream
  offsets.push(pos);
  const obj4 = `4 0 obj\n<< /Length ${streamContent.length} >>\nstream\n${streamContent}\nendstream\nendobj\n`;
  pos += obj4.length;

  // Object 5: Font
  offsets.push(pos);
  const obj5 = '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n';
  pos += obj5.length;

  objects.push(obj1, obj2, obj3, obj4, obj5);

  const xrefOffset = pos;
  const xref = [
    'xref',
    `0 6`,
    '0000000000 65535 f ',
    ...offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n `),
    '',
  ].join('\n');

  const trailer = `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  const pdfString = header + objects.join('') + xref + trailer;

  // Use Buffer to encode to base64 (Node.js environment)
  return Buffer.from(pdfString, 'binary').toString('base64');
}

@Tool({
  name: 'generate_offer_letter',
  description: 'Generate a PDF offer letter for a candidate with compensation details.',
  inputSchema,
  outputSchema,
  ui: {
    servingMode: 'auto',
    displayMode: 'inline',
    widgetDescription: 'Displays a generated PDF offer letter.',
    template: (ctx) => {
      const input = ctx.input as Input;
      const output = ctx.output as Output;
      return buildPdf(input.candidateName, input.role, input.department, output.salaryRange, input.startDate);
    },
  },
})
export default class GenerateOfferLetterTool extends ToolContext<typeof inputSchema, typeof outputSchema> {
  async execute(input: Input): Promise<Output> {
    const band = SALARY_BANDS[input.salaryBand];
    const salaryRange = band ? `$${(band.min / 1000).toFixed(0)}K - $${(band.max / 1000).toFixed(0)}K` : 'Competitive';

    return {
      candidateName: input.candidateName,
      role: input.role,
      salaryRange,
    };
  }
}
