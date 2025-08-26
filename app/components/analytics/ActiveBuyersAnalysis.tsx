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
import { Pagination } from '@/components/ui/pagination';

interface BuyingActivity {
    date: string;
    increase: number;
    newTotal: number;
}

interface ActiveBuyer {
    shareholderId: number;
    name: string;
    initialShares: number;
    finalShares: number;
    totalIncrease: number;
    increasePercent: string;
    initialOwnership: number;
    finalOwnership: number;
    ownershipChange: number;
    buyingDays: number;
    averageIncreasePerBuy: number;
    firstDate: string;
    lastDate: string;
    buyingActivity: BuyingActivity[];
}

interface TrendData {
    date: string;
    activeBuyers: number;
    sharesAccumulated: number;
}

interface Summary {
    totalActiveBuyers: number;
    totalSharesAccumulated: number;
    averageIncrease: number;
    topAccumulator: ActiveBuyer | null;
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

interface ActiveBuyersData {
    summary: Summary;
    buyers: ActiveBuyer[];
    trendData: TrendData[];
    pagination: PaginationInfo;
}

interface ActiveBuyersProps {
    startDate: string;
    endDate: string;
    periodType: 'daily' | 'monthly';
}

export default function ActiveBuyersAnalysis({ startDate, endDate, periodType }: ActiveBuyersProps) {
    const [data, setData] = useState<ActiveBuyersData | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [currentPage, setCurrentPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);
    const [dateFilter, setDateFilter] = useState('');

    const handleChartClick = (data: any) => {
        if (data && data.activePayload && data.activePayload.length > 0) {
            const clickedDate = data.activePayload[0].payload.date;
            console.log(clickedDate);
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
                params.append('buyerDateFilter', dateFilter);
            }

            const response = await fetch(`/api/analytics/active-buyers?${params}`);
            if (response.ok) {
                const result = await response.json();
                setData(result);
                console.log(result.pagination)
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
    }, [startDate, endDate, periodType, currentPage, pageSize, dateFilter]);

    const exportData = () => {
        if (!data) return;

        const csv = [
            ['Name', 'Initial Shares', 'Final Shares', 'Total Increase', 'Increase %', 'Buying Days', 'Average per Buy'],
            ...data.buyers.map((buyer: ActiveBuyer) => [
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
                        Number of active buyers and shares accumulated over time. Click on any point to filter the table by that date.
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
                                onClick={handleChartClick}
                                style={{ cursor: 'pointer' }}
                            />
                            <Line
                                yAxisId="right"
                                type="monotone"
                                dataKey="sharesAccumulated"
                                stroke="#10b981"
                                name="Shares Accumulated"
                                strokeWidth={2}
                                onClick={handleChartClick}
                                style={{ cursor: 'pointer' }}
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
                        <div className="flex items-center gap-4">
                            <div className="flex items-center gap-2">
                                <Label htmlFor="date-filter">Filter by buying date:</Label>
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
                                    <TableHead className="text-right">Total Increase</TableHead>
                                    <TableHead className="text-right">Increase %</TableHead>
                                    <TableHead className="text-right">Buying Days</TableHead>
                                    <TableHead className="text-right">Avg per Buy</TableHead>
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
                                ) : data.buyers.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={7} className="text-center py-8 text-gray-500">
                                            No active buyers found
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    data.buyers.map((buyer: ActiveBuyer) => (
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
