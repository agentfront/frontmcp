export const Card = ({
  title,
  subtitle,
  children,
}: {
  title?: string;
  subtitle?: string;
  elevation?: number;
  children?: React.ReactNode;
}) => {
  return (
    <div style={{ border: '1px solid #ccc', borderRadius: '8px', padding: '16px', maxWidth: '400px' }}>
      <h2>{title}</h2>
      <h4 style={{ color: '#666' }}>{subtitle}</h4>
      {children}
    </div>
  );
};

export const Badge = ({ label, variant }: { label: string; variant: 'success' | 'info' | 'default' }) => {
  return (
    <span
      style={{
        backgroundColor: variant === 'success' ? '#4caf50' : variant === 'info' ? '#2196f3' : '#9e9e9e',
        color: 'white',
        padding: '4px 8px',
        borderRadius: '4px',
        fontSize: '0.875rem',
        fontWeight: 'bold',
      }}
    >
      {label}
    </span>
  );
};
