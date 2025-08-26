import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface PaginationInfo {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
}

interface PaginationProps {
    pagination: PaginationInfo;
    onPageChange: (page: number) => void;
    isLoading?: boolean;
}

export function Pagination({ pagination, onPageChange, isLoading = false }: PaginationProps) {
    if (!pagination || pagination.totalPages <= 1) {
        return null;
    }

    return (
        <div className="flex items-center justify-between px-6 py-4 border-t">
            <div className="text-sm text-gray-600">
                Showing {((pagination.page - 1) * pagination.limit) + 1} to{' '}
                {Math.min(pagination.page * pagination.limit, pagination.total)} of{' '}
                {pagination.total} results
            </div>
            <div className="flex gap-2">
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onPageChange(pagination.page - 1)}
                    disabled={pagination.page === 1 || isLoading}
                >
                    <ChevronLeft className="h-4 w-4" />
                    Previous
                </Button>
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onPageChange(pagination.page + 1)}
                    disabled={pagination.page === pagination.totalPages || isLoading}
                >
                    Next
                    <ChevronRight className="h-4 w-4" />
                </Button>
            </div>
        </div>
    );
}
