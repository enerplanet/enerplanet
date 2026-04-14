import { Zap } from 'lucide-react';

interface MetricCardProps {
  icon: typeof Zap;
  label: string;
  value: string;
  subtitle?: string;
  color: string;
  bgColor: string;
}

const MetricCard = ({ icon: Icon, label, value, subtitle, color, bgColor }: MetricCardProps) => (
  <div className="bg-card border border-border rounded-xl p-3 hover:shadow-sm transition-shadow">
    <div className="flex items-center gap-3">
      <div className={`p-2 rounded-lg ${bgColor}`}>
        <Icon className={`w-4 h-4 ${color}`} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted-foreground font-medium truncate">{label}</p>
        <p className="text-base font-bold text-foreground truncate">{value}</p>
        {subtitle && <p className="text-[10px] text-muted-foreground truncate">{subtitle}</p>}
      </div>
    </div>
  </div>
);

export default MetricCard;
