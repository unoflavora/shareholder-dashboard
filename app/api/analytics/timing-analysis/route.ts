import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { shareholdings, shareholders } from '@/lib/db/schema';
import { sql, and, gte, lte, eq } from 'drizzle-orm';

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');

    if (!startDate || !endDate) {
      return NextResponse.json({ error: 'Start date and end date are required' }, { status: 400 });
    }

    // Get latest shares per day for each shareholder using D-1 vs D logic
    const dailyPositionsQuery = `
      WITH daily_positions AS (
        SELECT 
          s1.shareholder_id,
          s3.name as shareholder_name,
          s1.date,
          (SELECT s2.shares_amount FROM shareholdings s2 
           WHERE s2.shareholder_id = s1.shareholder_id AND s2.date = s1.date 
           ORDER BY s2.created_at DESC, s2.id DESC LIMIT 1) as latest_shares,
          (SELECT s2.percentage FROM shareholdings s2 
           WHERE s2.shareholder_id = s1.shareholder_id AND s2.date = s1.date 
           ORDER BY s2.created_at DESC, s2.id DESC LIMIT 1) as latest_percentage
        FROM shareholdings s1
        JOIN shareholders s3 ON s1.shareholder_id = s3.id
        WHERE s1.date >= '${startDate}' AND s1.date <= '${endDate}'
        GROUP BY s1.shareholder_id, s3.name, s1.date
        ORDER BY s1.date, s1.shareholder_id
      )
      SELECT * FROM daily_positions
    `;

    const dailyPositionsResult = await db.execute(sql.raw(dailyPositionsQuery));
    const dailyPositionsData = dailyPositionsResult[0] || [];

    // Group by date to analyze market-wide activity
    const dateActivityMap = new Map();
    
    dailyPositionsData.forEach(record => {
      if (!dateActivityMap.has(record.date)) {
        dateActivityMap.set(record.date, {
          date: record.date,
          totalShares: 0,
          shareholders: [],
          buyingActivity: 0,
          sellingActivity: 0
        });
      }
      
      const dayData = dateActivityMap.get(record.date);
      dayData.totalShares += record.latest_shares;
      dayData.shareholders.push({
        id: record.shareholder_id,
        name: record.shareholder_name,
        shares: record.latest_shares,
        percentage: record.latest_percentage
      });
    });

    // Group by shareholder to track individual patterns
    const shareholderPatterns = new Map();
    
    dailyPositionsData.forEach(record => {
      if (!shareholderPatterns.has(record.shareholder_id)) {
        shareholderPatterns.set(record.shareholder_id, {
          id: record.shareholder_id,
          name: record.shareholder_name,
          records: []
        });
      }
      
      shareholderPatterns.get(record.shareholder_id).records.push({
        date: record.date,
        shares: record.latest_shares,
        percentage: record.latest_percentage
      });
    });

    // Analyze timing patterns for each shareholder
    const timingAnalysis = [];
    
    for (const [shareholderId, data] of shareholderPatterns) {
      const records = data.records.sort((a, b) => 
        new Date(a.date).getTime() - new Date(b.date).getTime()
      );
      
      if (records.length < 2) continue;
      
      // Identify buy and sell periods using latest available previous data logic
      const buyPeriods = [];
      const sellPeriods = [];
      let entryPoints = [];
      let exitPoints = [];
      
      for (let i = 0; i < records.length; i++) {
        const currentRecord = records[i];
        
        // Find the latest record before this date
        let prevRecord = null;
        for (let j = i - 1; j >= 0; j--) {
          if (records[j].date < currentRecord.date) {
            prevRecord = records[j];
            break;
          }
        }
        
        if (prevRecord) {
          const change = currentRecord.shares - prevRecord.shares;
          const percentChange = prevRecord.shares > 0 
            ? ((change / prevRecord.shares) * 100) 
            : 0;
          
          if (change > 0) {
            buyPeriods.push({
              date: currentRecord.date,
              amount: change,
              percentIncrease: percentChange,
              newTotal: currentRecord.shares,
              ownership: currentRecord.percentage
            });
            
            // If this is a significant buy (>10% increase), mark as entry point
            if (percentChange > 10) {
              entryPoints.push({
                date: currentRecord.date,
                shares: change,
                totalAfter: currentRecord.shares
              });
            }
          } else if (change < 0) {
            sellPeriods.push({
              date: currentRecord.date,
              amount: Math.abs(change),
              percentDecrease: Math.abs(percentChange),
              newTotal: currentRecord.shares,
              ownership: currentRecord.percentage
            });
            
            // If this is a significant sell (>10% decrease), mark as exit point
            if (Math.abs(percentChange) > 10) {
              exitPoints.push({
                date: currentRecord.date,
                shares: Math.abs(change),
                totalAfter: currentRecord.shares
              });
            }
          }
        }
      }
      
      // Calculate timing metrics
      const totalBuys = buyPeriods.reduce((sum, p) => sum + p.amount, 0);
      const totalSells = sellPeriods.reduce((sum, p) => sum + p.amount, 0);
      const netPosition = records[records.length - 1].shares - records[0].shares;
      
      // Determine trader type based on pattern
      let traderType = 'holder';
      let timingScore = 0;
      
      if (buyPeriods.length > 0 && sellPeriods.length > 0) {
        // Check if they tend to accumulate then sell
        const avgBuyDate = buyPeriods.reduce((sum, p) => 
          sum + new Date(p.date).getTime(), 0) / buyPeriods.length;
        const avgSellDate = sellPeriods.reduce((sum, p) => 
          sum + new Date(p.date).getTime(), 0) / sellPeriods.length;
        
        if (avgSellDate > avgBuyDate) {
          // They buy first then sell - potential swing trader
          traderType = 'swing_trader';
          
          // Calculate timing score based on ownership changes
          const maxOwnership = Math.max(...records.map(r => r.percentage));
          const finalOwnership = records[records.length - 1].percentage;
          const initialOwnership = records[0].percentage;
          
          if (maxOwnership > initialOwnership * 1.5 && finalOwnership < maxOwnership * 0.5) {
            timingScore = 80; // Good timing - bought low, sold high
            traderType = 'smart_trader';
          } else {
            timingScore = 50;
          }
        } else {
          traderType = 'contrarian'; // Sells then buys back
          timingScore = 30;
        }
      } else if (buyPeriods.length > 3) {
        traderType = 'accumulator';
        timingScore = 60;
      } else if (sellPeriods.length > 3) {
        traderType = 'distributor';
        timingScore = 40;
      }
      
      timingAnalysis.push({
        shareholderId: shareholderId,
        name: data.name,
        traderType: traderType,
        timingScore: timingScore,
        buyPeriods: buyPeriods.length,
        sellPeriods: sellPeriods.length,
        totalBought: totalBuys,
        totalSold: totalSells,
        netPosition: netPosition,
        entryPoints: entryPoints,
        exitPoints: exitPoints,
        averageBuySize: buyPeriods.length > 0 ? Math.round(totalBuys / buyPeriods.length) : 0,
        averageSellSize: sellPeriods.length > 0 ? Math.round(totalSells / sellPeriods.length) : 0,
        firstRecord: records[0],
        lastRecord: records[records.length - 1]
      });
    }
    
    // Sort by timing score (best timers first)
    timingAnalysis.sort((a, b) => b.timingScore - a.timingScore);

    // Analyze market-wide timing patterns
    const marketTimingData = [];
    let prevTotalShares = null;
    
    for (const [date, data] of Array.from(dateActivityMap.entries()).sort()) {
      if (prevTotalShares !== null) {
        const change = data.totalShares - prevTotalShares;
        marketTimingData.push({
          date: date,
          totalShares: data.totalShares,
          netChange: change,
          activeTraders: data.shareholders.length,
          marketSentiment: change > 0 ? 'bullish' : change < 0 ? 'bearish' : 'neutral'
        });
      }
      prevTotalShares = data.totalShares;
    }

    // Identify smart money vs retail patterns
    const smartMoney = timingAnalysis.filter(t => t.timingScore >= 70);
    const retail = timingAnalysis.filter(t => t.timingScore < 50);
    
    // Group analysis - are smart traders from the same group or different?
    const smartMoneyGroups = new Map();
    smartMoney.forEach(trader => {
      // Group by similar entry/exit timing
      const groupKey = `${trader.entryPoints.length}-${trader.exitPoints.length}`;
      if (!smartMoneyGroups.has(groupKey)) {
        smartMoneyGroups.set(groupKey, []);
      }
      smartMoneyGroups.get(groupKey).push(trader);
    });
    
    // Statistics
    const traderTypeDistribution = {
      smart_trader: 0,
      swing_trader: 0,
      accumulator: 0,
      distributor: 0,
      contrarian: 0,
      holder: 0
    };
    
    timingAnalysis.forEach(trader => {
      traderTypeDistribution[trader.traderType]++;
    });

    return NextResponse.json({
      summary: {
        totalAnalyzed: timingAnalysis.length,
        smartTradersCount: smartMoney.length,
        averageTimingScore: timingAnalysis.length > 0 
          ? Math.round(timingAnalysis.reduce((sum, t) => sum + t.timingScore, 0) / timingAnalysis.length)
          : 0,
        traderTypeDistribution,
        topTimer: timingAnalysis[0] || null,
        period: {
          start: startDate,
          end: endDate
        }
      },
      timingAnalysis: timingAnalysis.slice(0, 50),
      smartMoney: smartMoney.slice(0, 20),
      marketTimingData: marketTimingData,
      smartMoneyGroups: Array.from(smartMoneyGroups.entries()).map(([key, traders]) => ({
        pattern: key,
        traders: traders.map(t => ({ id: t.shareholderId, name: t.name, score: t.timingScore })),
        count: traders.length,
        groupType: traders.length > 3 ? 'coordinated_group' : 'independent_traders'
      }))
    });
  } catch (error) {
    console.error('Error analyzing timing patterns:', error);
    return NextResponse.json(
      { error: 'Failed to analyze timing patterns' },
      { status: 500 }
    );
  }
}