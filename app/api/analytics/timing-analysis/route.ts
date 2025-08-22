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

    // Get all shareholdings within the date range
    const shareholdingsData = await db
      .select({
        shareholderId: shareholdings.shareholderId,
        shareholderName: shareholders.name,
        date: shareholdings.date,
        shares: shareholdings.sharesAmount,
        percentage: shareholdings.percentage,
      })
      .from(shareholdings)
      .innerJoin(shareholders, eq(shareholdings.shareholderId, shareholders.id))
      .where(and(
        gte(shareholdings.date, startDate),
        lte(shareholdings.date, endDate)
      ))
      .orderBy(shareholdings.date, shareholdings.shareholderId);

    // Group by date to analyze market-wide activity
    const dateActivityMap = new Map();
    
    shareholdingsData.forEach(record => {
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
      dayData.totalShares += record.shares;
      dayData.shareholders.push({
        id: record.shareholderId,
        name: record.shareholderName,
        shares: record.shares,
        percentage: record.percentage
      });
    });

    // Group by shareholder to track individual patterns
    const shareholderPatterns = new Map();
    
    shareholdingsData.forEach(record => {
      if (!shareholderPatterns.has(record.shareholderId)) {
        shareholderPatterns.set(record.shareholderId, {
          id: record.shareholderId,
          name: record.shareholderName,
          records: []
        });
      }
      
      shareholderPatterns.get(record.shareholderId).records.push({
        date: record.date,
        shares: record.shares,
        percentage: record.percentage
      });
    });

    // Analyze timing patterns for each shareholder
    const timingAnalysis = [];
    
    for (const [shareholderId, data] of shareholderPatterns) {
      const records = data.records.sort((a, b) => 
        new Date(a.date).getTime() - new Date(b.date).getTime()
      );
      
      if (records.length < 2) continue;
      
      // Identify buy and sell periods
      const buyPeriods = [];
      const sellPeriods = [];
      let entryPoints = [];
      let exitPoints = [];
      
      for (let i = 1; i < records.length; i++) {
        const change = records[i].shares - records[i-1].shares;
        const percentChange = records[i-1].shares > 0 
          ? ((change / records[i-1].shares) * 100) 
          : 0;
        
        if (change > 0) {
          buyPeriods.push({
            date: records[i].date,
            amount: change,
            percentIncrease: percentChange,
            newTotal: records[i].shares,
            ownership: records[i].percentage
          });
          
          // If this is a significant buy (>10% increase), mark as entry point
          if (percentChange > 10) {
            entryPoints.push({
              date: records[i].date,
              shares: change,
              totalAfter: records[i].shares
            });
          }
        } else if (change < 0) {
          sellPeriods.push({
            date: records[i].date,
            amount: Math.abs(change),
            percentDecrease: Math.abs(percentChange),
            newTotal: records[i].shares,
            ownership: records[i].percentage
          });
          
          // If this is a significant sell (>10% decrease), mark as exit point
          if (Math.abs(percentChange) > 10) {
            exitPoints.push({
              date: records[i].date,
              shares: Math.abs(change),
              totalAfter: records[i].shares
            });
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