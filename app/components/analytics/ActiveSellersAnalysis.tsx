'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
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
import { Loader2, TrendingDown, Download } from 'lucide-react';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Pagination } from '@/components/ui/pagination';

interface SellingActivity {
  date: string;
  decrease: number;
  newTotal: number;
}

interface ActiveSeller {
  shareholderId: number;
  name: string;
  initialShares: number;
  finalShares: number;
  totalDecrease: number;
  decreasePercent: string;
  initialOwnership: number;
  finalOwnership: number;
  ownershipChange: number;
  exitStatus: string;
  sellingDays: number;
  averageDecreasePerSell: number;
  firstDate: string;
  lastDate: string;
  sellingActivity: SellingActivity[];
}

interface TrendData {
  date: string;
  activeSellers: number;
  sharesSold: number;
  fullExits: number;
  partialExits: number;
}

interface Summary {
  totalActiveSellers: number;
  fullExits: number;
  partialExits: number;
  totalSharesSold: number;
  averageDecrease: number;
  topSeller: ActiveSeller | null;
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

interface ActiveSellersData {
  summary: Summary;
  sellers: ActiveSeller[];
  trendData: TrendData[];
  pagination: PaginationInfo;
}

interface ActiveSellersProps {
  startDate: string;
  endDate: string;
  periodType: 'daily' | 'monthly';
}

export default function ActiveSellersAnalysis({ startDate, endDate, periodType }: ActiveSellersProps) {
  const [data, setData] = useState<ActiveSellersData | null>(null);
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
        params.append('sellerDateFilter', dateFilter);
      }
      
      const response = await fetch(`/api/analytics/active-sellers?${params}`);
      if (response.ok) {
        const result = await response.json();
        setData(result);
      } else {
        toast.error('Failed to fetch active sellers data');
      }
    } catch (error) {
      console.error('Error fetching active sellers:', error);
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
      ['Name', 'Initial Shares', 'Final Shares', 'Total Decrease', 'Decrease %', 'Exit Status', 'Selling Days'],
      ...data.sellers.map((seller: ActiveSeller) => [
        seller.name,
        seller.initialShares,
        seller.finalShares,
        seller.totalDecrease,
        seller.decreasePercent,
        seller.exitStatus,
        seller.sellingDays
      ])
    ].map(row => row.join(',')).join('\n');
    
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `active-sellers-${startDate}-to-${endDate}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  const getExitStatusBadge = (status: string) => {
    switch (status) {
      case 'Full Exit':
        return <Badge variant="destructive">{status}</Badge>;
      case 'Complete Disappearance':
        return <Badge variant="destructive">Disappeared</Badge>;
      case 'Partial Exit':
        return <Badge variant="secondary">{status}</Badge>;
      default:
        return <Badge>{status}</Badge>;
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
            <div className="text-2xl font-bold">{data.summary.totalActiveSellers}</div>
            <p className="text-xs text-muted-foreground">Active Sellers</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold text-red-600">{data.summary.fullExits}</div>
            <p className="text-xs text-muted-foreground">Full Exits</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold text-orange-600">{data.summary.partialExits}</div>
            <p className="text-xs text-muted-foreground">Partial Exits</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">
              {data.summary.totalSharesSold.toLocaleString()}
            </div>
            <p className="text-xs text-muted-foreground">Shares Sold</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">
              {data.summary.topSeller?.name || 'N/A'}
            </div>
            <p className="text-xs text-muted-foreground">Top Seller</p>
          </CardContent>
        </Card>
      </div>

      {/* Trend Chart */}
      <Card>
        <CardHeader>
          <CardTitle>Selling Activity Trend</CardTitle>
          <CardDescription>
            Number of active sellers and exit patterns over time. Click on any point to filter the table by that date.
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
                dataKey="activeSellers"
                stroke="#ef4444"
                name="Active Sellers"
                strokeWidth={2}
                onClick={handleChartClick}
                style={{ cursor: 'pointer' }}
              />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="sharesSold"
                stroke="#f97316"
                name="Shares Sold"
                strokeWidth={2}
                onClick={handleChartClick}
                style={{ cursor: 'pointer' }}
              />
              <Line
                yAxisId="left"
                type="monotone"
                dataKey="fullExits"
                stroke="#dc2626"
                name="Full Exits"
                strokeWidth={2}
                strokeDasharray="5 5"
                onClick={handleChartClick}
                style={{ cursor: 'pointer' }}
              />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Exit Type Distribution */}
      <Card>
        <CardHeader>
          <CardTitle>Exit Pattern Distribution</CardTitle>
          <CardDescription>
            Breakdown of full vs partial exits over time. Click on any bar to filter the table by that date.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={data.trendData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis 
                dataKey="date" 
                tickFormatter={(value) => 
                  periodType === 'monthly' ? value : new Date(value).toLocaleDateString()
                }
              />
              <YAxis />
              <Tooltip 
                labelFormatter={(value) => 
                  periodType === 'monthly' ? value : new Date(value).toLocaleDateString()
                }
              />
              <Legend />
              <Bar 
                dataKey="fullExits" 
                stackId="a" 
                fill="#dc2626" 
                name="Full Exits"
                onClick={handleChartClick}
                style={{ cursor: 'pointer' }}
              />
              <Bar 
                dataKey="partialExits" 
                stackId="a" 
                fill="#fb923c" 
                name="Partial Exits"
                onClick={handleChartClick}
                style={{ cursor: 'pointer' }}
              />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Sellers Table */}
      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <div>
              <CardTitle>Active Sellers Details</CardTitle>
              <CardDescription>
                Shareholders who reduced or exited their positions
              </CardDescription>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <Label htmlFor="date-filter">Filter by selling date:</Label>
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
                  <TableHead className="text-right">Initial Shares</TableHead>
                  <TableHead className="text-right">Final Shares</TableHead>
                  <TableHead className="text-right">Total Sold</TableHead>
                  <TableHead className="text-right">Decrease %</TableHead>
                  <TableHead>Exit Status</TableHead>
                  <TableHead className="text-right">Selling Days</TableHead>
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
                ) : data.sellers.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-gray-500">
                      No active sellers found
                    </TableCell>
                  </TableRow>
                ) : (
                  data.sellers.map((seller: ActiveSeller) => (
                    <TableRow key={seller.shareholderId}>
                      <TableCell className="font-medium">{seller.name}</TableCell>
                      <TableCell className="text-right">
                        {seller.initialShares.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right">
                        {seller.finalShares.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right text-red-600">
                        -{seller.totalDecrease.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right">
                        {seller.decreasePercent}%
                      </TableCell>
                      <TableCell>{getExitStatusBadge(seller.exitStatus)}</TableCell>
                      <TableCell className="text-right">{seller.sellingDays}</TableCell>
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