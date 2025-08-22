'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
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
import { Loader2, TrendingUp, Download } from 'lucide-react';
import { toast } from 'sonner';

interface ActiveBuyersProps {
  startDate: string;
  endDate: string;
  periodType: 'daily' | 'monthly';
}

export default function ActiveBuyersAnalysis({ startDate, endDate, periodType }: ActiveBuyersProps) {
  const [data, setData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);

  const fetchData = async () => {
    if (!startDate || !endDate) return;
    
    setIsLoading(true);
    try {
      const params = new URLSearchParams({
        startDate,
        endDate,
        periodType
      });
      
      const response = await fetch(`/api/analytics/active-buyers?${params}`);
      if (response.ok) {
        const result = await response.json();
        setData(result);
      } else {
        toast.error('Failed to fetch active buyers data');
      }
    } catch (error) {
      console.error('Error fetching active buyers:', error);
      toast.error('An error occurred while fetching data');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [startDate, endDate, periodType]);

  const exportData = () => {
    if (!data) return;
    
    const csv = [
      ['Name', 'Initial Shares', 'Final Shares', 'Total Increase', 'Increase %', 'Buying Days', 'Average per Buy'],
      ...data.buyers.map((buyer: any) => [
        buyer.name,
        buyer.initialShares,
        buyer.finalShares,
        buyer.totalIncrease,
        buyer.increasePercent,
        buyer.buyingDays,
        buyer.averageIncreasePerBuy
      ])
    ].map(row => row.join(',')).join('\n');
    
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `active-buyers-${startDate}-to-${endDate}.csv`;
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
            <div className="text-2xl font-bold">{data.summary.totalActiveBuyers}</div>
            <p className="text-xs text-muted-foreground">Active Buyers</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">
              {data.summary.totalSharesAccumulated.toLocaleString()}
            </div>
            <p className="text-xs text-muted-foreground">Shares Accumulated</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">
              {data.summary.averageIncrease.toLocaleString()}
            </div>
            <p className="text-xs text-muted-foreground">Average Increase</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">
              {data.summary.topAccumulator?.name || 'N/A'}
            </div>
            <p className="text-xs text-muted-foreground">Top Accumulator</p>
          </CardContent>
        </Card>
      </div>

      {/* Trend Chart */}
      <Card>
        <CardHeader>
          <CardTitle>Buying Activity Trend</CardTitle>
          <CardDescription>
            Number of active buyers and shares accumulated over time
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={400}>
            <LineChart data={data.trendData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis 
                dataKey="date" 
                tickFormatter={(value) => 
                  periodType === 'monthly' ? value : new Date(value).toLocaleDateString()
                }
              />
              <YAxis yAxisId="left" />
              <YAxis yAxisId="right" orientation="right" />
              <Tooltip 
                labelFormatter={(value) => 
                  periodType === 'monthly' ? value : new Date(value).toLocaleDateString()
                }
                formatter={(value: any) => value.toLocaleString()}
              />
              <Legend />
              <Line
                yAxisId="left"
                type="monotone"
                dataKey="activeBuyers"
                stroke="#3b82f6"
                name="Active Buyers"
                strokeWidth={2}
              />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="sharesAccumulated"
                stroke="#10b981"
                name="Shares Accumulated"
                strokeWidth={2}
              />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Buyers Table */}
      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <div>
              <CardTitle>Active Buyers Details</CardTitle>
              <CardDescription>
                Shareholders who increased their positions during the period
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
                  <TableHead className="text-right">Initial Shares</TableHead>
                  <TableHead className="text-right">Final Shares</TableHead>
                  <TableHead className="text-right">Total Increase</TableHead>
                  <TableHead className="text-right">Increase %</TableHead>
                  <TableHead className="text-right">Buying Days</TableHead>
                  <TableHead className="text-right">Avg per Buy</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.buyers.slice(0, 20).map((buyer: any, index: number) => (
                  <TableRow key={buyer.shareholderId}>
                    <TableCell className="font-medium">{buyer.name}</TableCell>
                    <TableCell className="text-right">
                      {buyer.initialShares.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right">
                      {buyer.finalShares.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right text-green-600">
                      +{buyer.totalIncrease.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right">
                      {buyer.increasePercent}%
                    </TableCell>
                    <TableCell className="text-right">{buyer.buyingDays}</TableCell>
                    <TableCell className="text-right">
                      {buyer.averageIncreasePerBuy.toLocaleString()}
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