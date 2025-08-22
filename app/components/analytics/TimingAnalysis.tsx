'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { Loader2, Target, Users2, Download, TrendingUp } from 'lucide-react';
import { toast } from 'sonner';

interface TimingAnalysisProps {
  startDate: string;
  endDate: string;
}

export default function TimingAnalysis({ startDate, endDate }: TimingAnalysisProps) {
  const [data, setData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);

  const fetchData = async () => {
    if (!startDate || !endDate) return;
    
    setIsLoading(true);
    try {
      const params = new URLSearchParams({
        startDate,
        endDate
      });
      
      const response = await fetch(`/api/analytics/timing-analysis?${params}`);
      if (response.ok) {
        const result = await response.json();
        setData(result);
      } else {
        toast.error('Failed to fetch timing analysis');
      }
    } catch (error) {
      console.error('Error fetching timing analysis:', error);
      toast.error('An error occurred while fetching data');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [startDate, endDate]);

  const getTraderTypeBadge = (type: string) => {
    const variants: Record<string, any> = {
      smart_trader: { className: 'bg-green-100 text-green-800' },
      swing_trader: { className: 'bg-blue-100 text-blue-800' },
      accumulator: { className: 'bg-purple-100 text-purple-800' },
      distributor: { className: 'bg-orange-100 text-orange-800' },
      contrarian: { className: 'bg-yellow-100 text-yellow-800' },
      holder: { className: 'bg-gray-100 text-gray-800' }
    };
    
    const config = variants[type] || {};
    return <Badge {...config}>{type.replace(/_/g, ' ').toUpperCase()}</Badge>;
  };

  const getTimingScoreColor = (score: number) => {
    if (score >= 70) return 'text-green-600';
    if (score >= 50) return 'text-blue-600';
    if (score >= 30) return 'text-orange-600';
    return 'text-red-600';
  };

  const exportData = () => {
    if (!data) return;
    
    const csv = [
      ['Name', 'Trader Type', 'Timing Score', 'Buy Periods', 'Sell Periods', 'Total Bought', 'Total Sold', 'Net Position'],
      ...data.timingAnalysis.map((trader: any) => [
        trader.name,
        trader.traderType,
        trader.timingScore,
        trader.buyPeriods,
        trader.sellPeriods,
        trader.totalBought,
        trader.totalSold,
        trader.netPosition
      ])
    ].map(row => row.join(',')).join('\n');
    
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `timing-analysis-${startDate}-to-${endDate}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (!data) {
    return <div className="text-center p-8 text-gray-500">No data available</div>;
  }

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">{data.summary.totalAnalyzed}</div>
            <p className="text-xs text-muted-foreground">Traders Analyzed</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold flex items-center">
              <Target className="h-5 w-5 mr-2 text-green-600" />
              {data.summary.smartTradersCount}
            </div>
            <p className="text-xs text-muted-foreground">Smart Traders</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">{data.summary.averageTimingScore}</div>
            <Progress value={data.summary.averageTimingScore} className="mt-2" />
            <p className="text-xs text-muted-foreground">Avg Timing Score</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">
              {data.summary.topTimer?.name || 'N/A'}
            </div>
            <p className="text-xs text-muted-foreground">Best Timer</p>
            {data.summary.topTimer && (
              <p className="text-xs text-green-600 mt-1">
                Score: {data.summary.topTimer.timingScore}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Trader Type Distribution */}
      <Card>
        <CardHeader>
          <CardTitle>Trader Type Distribution</CardTitle>
          <CardDescription>
            Classification based on buy/sell timing patterns
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3">
            {Object.entries(data.summary.traderTypeDistribution).map(([type, count]: [string, any]) => (
              <div key={type} className="flex items-center justify-between p-3 border rounded">
                <div>{getTraderTypeBadge(type)}</div>
                <span className="text-2xl font-bold">{count}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Market Timing Chart */}
      <Card>
        <CardHeader>
          <CardTitle>Market Timing Sentiment</CardTitle>
          <CardDescription>
            Overall market activity and sentiment over time
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={400}>
            <LineChart data={data.marketTimingData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis 
                dataKey="date" 
                tickFormatter={(value) => new Date(value).toLocaleDateString()}
              />
              <YAxis yAxisId="left" />
              <YAxis yAxisId="right" orientation="right" />
              <Tooltip 
                labelFormatter={(value) => new Date(value).toLocaleDateString()}
                formatter={(value: any) => value.toLocaleString()}
                content={({ active, payload, label }) => {
                  if (active && payload && payload.length) {
                    const data = payload[0].payload;
                    return (
                      <div className="bg-white p-3 border rounded shadow">
                        <p className="font-semibold">{label}</p>
                        <p className="text-sm">Total Shares: {data.totalShares?.toLocaleString()}</p>
                        <p className="text-sm">Net Change: {data.netChange?.toLocaleString()}</p>
                        <p className="text-sm">Active Traders: {data.activeTraders}</p>
                        <p className="text-sm">
                          Sentiment: 
                          <Badge className="ml-2" variant={
                            data.marketSentiment === 'bullish' ? 'default' :
                            data.marketSentiment === 'bearish' ? 'destructive' : 'secondary'
                          }>
                            {data.marketSentiment}
                          </Badge>
                        </p>
                      </div>
                    );
                  }
                  return null;
                }}
              />
              <Legend />
              <Line
                yAxisId="left"
                type="monotone"
                dataKey="totalShares"
                stroke="#3b82f6"
                name="Total Shares"
                strokeWidth={2}
              />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="netChange"
                stroke="#10b981"
                name="Net Change"
                strokeWidth={2}
              />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Smart Money Groups */}
      {data.smartMoneyGroups && data.smartMoneyGroups.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Smart Money Groups</CardTitle>
            <CardDescription>
              Groups of traders with similar successful timing patterns
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {data.smartMoneyGroups.map((group: any, index: number) => (
                <div key={index} className="border rounded p-4">
                  <div className="flex justify-between items-center mb-2">
                    <Badge variant={group.groupType === 'coordinated_group' ? 'default' : 'secondary'}>
                      {group.groupType.replace(/_/g, ' ').toUpperCase()}
                    </Badge>
                    <span className="text-sm text-gray-600">
                      {group.count} traders
                    </span>
                  </div>
                  <div className="space-y-1">
                    {group.traders.slice(0, 5).map((trader: any, i: number) => (
                      <div key={i} className="flex justify-between text-sm">
                        <span>{trader.name}</span>
                        <span className={getTimingScoreColor(trader.score)}>
                          Score: {trader.score}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Timing Analysis Table */}
      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <div>
              <CardTitle>Trader Timing Analysis</CardTitle>
              <CardDescription>
                Individual trader timing patterns and scores
              </CardDescription>
            </div>
            <Button onClick={exportData} variant="outline" size="sm">
              <Download className="mr-2 h-4 w-4" />
              Export CSV
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Trader Type</TableHead>
                  <TableHead>Timing Score</TableHead>
                  <TableHead className="text-right">Buy Periods</TableHead>
                  <TableHead className="text-right">Sell Periods</TableHead>
                  <TableHead className="text-right">Total Bought</TableHead>
                  <TableHead className="text-right">Total Sold</TableHead>
                  <TableHead className="text-right">Net Position</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.timingAnalysis.slice(0, 20).map((trader: any) => (
                  <TableRow key={trader.shareholderId}>
                    <TableCell className="font-medium">{trader.name}</TableCell>
                    <TableCell>{getTraderTypeBadge(trader.traderType)}</TableCell>
                    <TableCell>
                      <span className={getTimingScoreColor(trader.timingScore)}>
                        {trader.timingScore}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">{trader.buyPeriods}</TableCell>
                    <TableCell className="text-right">{trader.sellPeriods}</TableCell>
                    <TableCell className="text-right">
                      {trader.totalBought.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right">
                      {trader.totalSold.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <span className={trader.netPosition >= 0 ? 'text-green-600' : 'text-red-600'}>
                        {trader.netPosition >= 0 ? '+' : ''}
                        {trader.netPosition.toLocaleString()}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}