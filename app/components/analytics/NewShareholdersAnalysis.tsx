'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { Loader2, UserPlus, Download, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Pagination } from '@/components/ui/pagination';

// Helper function to format large numbers
const formatNumber = (value: number) => {
  if (value >= 1000000000) {
    return (value / 1000000000).toFixed(1) + 'B';
  } else if (value >= 1000000) {
    return (value / 1000000).toFixed(1) + 'M';
  } else if (value >= 1000) {
    return (value / 1000).toFixed(0) + 'K';
  }
  return value.toString();
};

interface NewShareholder {
  shareholderId: number;
  name: string;
  entryDate: string;
  initialShares: number;
  currentShares: number;
  growthSinceEntry: number;
  growthPercent: string;
  initialOwnership: number;
  currentOwnership: number;
  ownershipChange: number;
  daysActive: number;
  trajectory: string;
}

interface EntryTrendData {
  date: string;
  newEntrants: number;
  totalInitialShares: number;
  totalCurrentShares: number;
  averageEntry: number;
  entrantNames: string[];
}

interface Summary {
  totalNewShareholders: number;
  totalInitialInvestment: number;
  totalCurrentHoldings: number;
  netChange: number;
  averageEntrySize: number;
  trajectories: {
    accumulating: number;
    reducing: number;
    stable: number;
  };
  topNewEntrant: NewShareholder | null;
  period: {
    start: string;
    end: string;
    type: string;
  };
}

interface PaginationInfo {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

interface NewShareholdersData {
  summary: Summary;
  newShareholders: NewShareholder[];
  entryTrendData: EntryTrendData[];
  pagination: PaginationInfo;
}

interface NewShareholdersProps {
  startDate: string;
  endDate: string;
  periodType: 'daily' | 'monthly';
}

export default function NewShareholdersAnalysis({ startDate, endDate, periodType }: NewShareholdersProps) {
  const [data, setData] = useState<NewShareholdersData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [dateFilter, setDateFilter] = useState('');

  const handleChartClick = (data: any) => {
    if (data && data.activePayload && data.activePayload.length > 0) {
      const clickedDate = data.activePayload[0].payload.date;
      setDateFilter(clickedDate);
      setCurrentPage(1);
    }
  };

  const fetchData = async () => {
    if (!startDate || !endDate) return;
    
    setIsLoading(true);
    try {
      const params = new URLSearchParams({
        startDate,
        endDate,
        periodType,
        page: currentPage.toString(),
        limit: pageSize.toString()
      });
      
      if (dateFilter) {
        params.append('entryDateFilter', dateFilter);
      }
      
      const response = await fetch(`/api/analytics/new-shareholders?${params}`);
      if (response.ok) {
        const result = await response.json();
        setData(result);
      } else {
        toast.error('Failed to fetch new shareholders data');
      }
    } catch (error) {
      console.error('Error fetching new shareholders:', error);
      toast.error('An error occurred while fetching data');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [startDate, endDate, periodType, currentPage, pageSize, dateFilter]);

  const exportData = () => {
    if (!data) return;
    
    const csv = [
      ['Name', 'Entry Date', 'Initial Shares', 'Current Shares', 'Growth', 'Growth %', 'Trajectory'],
      ...data.newShareholders.map((shareholder: NewShareholder) => [
        shareholder.name,
        shareholder.entryDate,
        shareholder.initialShares,
        shareholder.currentShares,
        shareholder.growthSinceEntry,
        shareholder.growthPercent,
        shareholder.trajectory
      ])
    ].map(row => row.join(',')).join('\n');
    
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `new-shareholders-${startDate}-to-${endDate}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  const getTrajectoryIcon = (trajectory: string) => {
    switch (trajectory) {
      case 'Accumulating':
        return <TrendingUp className="h-4 w-4 text-green-600" />;
      case 'Reducing':
        return <TrendingDown className="h-4 w-4 text-red-600" />;
      default:
        return <Minus className="h-4 w-4 text-gray-600" />;
    }
  };

  const getTrajectoryBadge = (trajectory: string) => {
    switch (trajectory) {
      case 'Accumulating':
        return <Badge className="bg-green-100 text-green-800">{trajectory}</Badge>;
      case 'Reducing':
        return <Badge className="bg-red-100 text-red-800">{trajectory}</Badge>;
      default:
        return <Badge variant="secondary">{trajectory}</Badge>;
    }
  };

  if (!data && isLoading) {
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
      <div className="grid gap-4 md:grid-cols-5">
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold flex items-center">
              <UserPlus className="h-5 w-5 mr-2 text-blue-600" />
              {data.summary.totalNewShareholders}
            </div>
            <p className="text-xs text-muted-foreground">New Shareholders</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">
              {data.summary.totalInitialInvestment.toLocaleString()}
            </div>
            <p className="text-xs text-muted-foreground">Initial Investment</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">
              {data.summary.totalCurrentHoldings.toLocaleString()}
            </div>
            <p className="text-xs text-muted-foreground">Current Holdings</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className={`text-2xl font-bold ${data.summary.netChange >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {data.summary.netChange >= 0 ? '+' : ''}{data.summary.netChange.toLocaleString()}
            </div>
            <p className="text-xs text-muted-foreground">Net Change</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">
              {data.summary.averageEntrySize.toLocaleString()}
            </div>
            <p className="text-xs text-muted-foreground">Avg Entry Size</p>
          </CardContent>
        </Card>
      </div>

      {/* Trajectory Distribution */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-2xl font-bold text-green-600">
                  {data.summary.trajectories.accumulating}
                </div>
                <p className="text-xs text-muted-foreground">Accumulating</p>
              </div>
              <TrendingUp className="h-8 w-8 text-green-600 opacity-20" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-2xl font-bold text-red-600">
                  {data.summary.trajectories.reducing}
                </div>
                <p className="text-xs text-muted-foreground">Reducing</p>
              </div>
              <TrendingDown className="h-8 w-8 text-red-600 opacity-20" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-2xl font-bold text-gray-600">
                  {data.summary.trajectories.stable}
                </div>
                <p className="text-xs text-muted-foreground">Stable</p>
              </div>
              <Minus className="h-8 w-8 text-gray-600 opacity-20" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Entry Trend Chart */}
      <Card>
        <CardHeader>
          <CardTitle>New Shareholder Entry Trend</CardTitle>
          <CardDescription>
            Number of new shareholders entering over time. Click on any point to filter the table by that date.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={400}>
            <LineChart data={data.entryTrendData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis 
                dataKey="date" 
                tickFormatter={(value) => 
                  periodType === 'monthly' ? value : new Date(value).toLocaleDateString()
                }
              />
              <YAxis yAxisId="left" tickFormatter={formatNumber} />
              <YAxis yAxisId="right" orientation="right" tickFormatter={formatNumber} />
              <Tooltip 
                labelFormatter={(value) => 
                  periodType === 'monthly' ? value : new Date(value).toLocaleDateString()
                }
                formatter={(value: any) => value.toLocaleString()}
                content={({ active, payload, label }) => {
                  if (active && payload && payload.length) {
                    const data = payload[0].payload;
                    return (
                      <div className="bg-white p-3 border rounded shadow">
                        <p className="font-semibold">{label}</p>
                        <p className="text-sm">New Entrants: {data.newEntrants}</p>
                        <p className="text-sm">Total Shares: {data.totalInitialShares.toLocaleString()}</p>
                        <p className="text-sm">Average: {data.averageEntry.toLocaleString()}</p>
                        {data.entrantNames && data.entrantNames.length > 0 && (
                          <div className="mt-2 text-xs">
                            <p className="font-semibold">Top Entrants:</p>
                            {data.entrantNames.map((name: string, i: number) => (
                              <p key={i}>• {name}</p>
                            ))}
                          </div>
                        )}
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
                dataKey="newEntrants"
                stroke="#3b82f6"
                name="New Entrants"
                strokeWidth={2}
                onClick={handleChartClick}
                style={{ cursor: 'pointer' }}
              />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="totalInitialShares"
                stroke="#10b981"
                name="Total Initial Shares"
                strokeWidth={2}
                onClick={handleChartClick}
                style={{ cursor: 'pointer' }}
              />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Investment Volume Chart */}
      <Card>
        <CardHeader>
          <CardTitle>New Shareholder Investment Volume</CardTitle>
          <CardDescription>
            Initial vs current holdings of new shareholders. Click on any bar to filter the table by that date.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={data.entryTrendData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis 
                dataKey="date" 
                tickFormatter={(value) => 
                  periodType === 'monthly' ? value : new Date(value).toLocaleDateString()
                }
              />
              <YAxis tickFormatter={formatNumber} />
              <Tooltip 
                labelFormatter={(value) => 
                  periodType === 'monthly' ? value : new Date(value).toLocaleDateString()
                }
                formatter={(value: any) => value.toLocaleString()}
              />
              <Legend />
              <Bar 
                dataKey="totalInitialShares" 
                fill="#3b82f6" 
                name="Initial Shares"
                onClick={handleChartClick}
                style={{ cursor: 'pointer' }}
              />
              <Bar 
                dataKey="totalCurrentShares" 
                fill="#10b981" 
                name="Current Shares"
                onClick={handleChartClick}
                style={{ cursor: 'pointer' }}
              />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* New Shareholders Table */}
      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <div>
              <CardTitle>New Shareholders Details</CardTitle>
              <CardDescription>
                Shareholders who entered during the period
              </CardDescription>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <Label htmlFor="date-filter">Filter by entry date:</Label>
                <Input
                  id="date-filter"
                  type="date"
                  value={dateFilter}
                  onChange={(e) => {
                    setDateFilter(e.target.value);
                    setCurrentPage(1);
                  }}
                  className="w-40"
                  placeholder="Click chart or select date"
                />
                {dateFilter && (
                  <Button
                    onClick={() => {
                      setDateFilter('');
                      setCurrentPage(1);
                    }}
                    variant="outline"
                    size="sm"
                  >
                    Clear
                  </Button>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Label htmlFor="page-size">Show:</Label>
                <Select
                  value={pageSize.toString()}
                  onValueChange={(value) => {
                    setPageSize(parseInt(value));
                    setCurrentPage(1);
                  }}
                >
                  <SelectTrigger className="w-20">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="10">10</SelectItem>
                    <SelectItem value="25">25</SelectItem>
                    <SelectItem value="50">50</SelectItem>
                    <SelectItem value="100">100</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={exportData} variant="outline" size="sm">
                <Download className="mr-2 h-4 w-4" />
                Export CSV
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Entry Date</TableHead>
                  <TableHead className="text-right">Initial Shares</TableHead>
                  <TableHead className="text-right">Current Shares</TableHead>
                  <TableHead className="text-right">Growth</TableHead>
                  <TableHead className="text-right">Growth %</TableHead>
                  <TableHead>Trajectory</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8">
                      <div className="flex items-center justify-center">
                        <Loader2 className="h-6 w-6 animate-spin mr-2" />
                        Loading...
                      </div>
                    </TableCell>
                  </TableRow>
                ) : data.newShareholders.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-gray-500">
                      No new shareholders found
                    </TableCell>
                  </TableRow>
                ) : (
                  data.newShareholders.map((shareholder: NewShareholder) => (
                    <TableRow key={shareholder.shareholderId}>
                      <TableCell className="font-medium">{shareholder.name}</TableCell>
                      <TableCell>{new Date(shareholder.entryDate).toLocaleDateString()}</TableCell>
                      <TableCell className="text-right">
                        {shareholder.initialShares.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right">
                        {shareholder.currentShares.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right">
                        <span className={shareholder.growthSinceEntry >= 0 ? 'text-green-600' : 'text-red-600'}>
                          {shareholder.growthSinceEntry >= 0 ? '+' : ''}
                          {shareholder.growthSinceEntry.toLocaleString()}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        {shareholder.growthPercent}%
                      </TableCell>
                      <TableCell>{getTrajectoryBadge(shareholder.trajectory)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          <Pagination 
            pagination={data.pagination}
            onPageChange={setCurrentPage}
            isLoading={isLoading}
          />
        </CardContent>
      </Card>
    </div>
  );
}