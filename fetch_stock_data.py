#!/usr/bin/env python3
"""
股票数据抓取脚本
抓取A股（沪深300 + 中证500 + 中证1000）日K线数据。

日期窗口：自 2024-01-01 起至 Asia/Shanghai 的“今天”。
不再硬编码单一日历年，重跑即可覆盖到最新交易日。

每只股票写入 py（全拼）/ jp（简拼），供悔棋局联想。
"""

import akshare as ak
import pandas as pd
import json
import time
import os
from datetime import datetime, timezone, timedelta

try:
    from pypinyin import lazy_pinyin, Style
except ImportError:  # pragma: no cover
    lazy_pinyin = None
    Style = None

# 配置
TARGET_STOCK_COUNT = 1000  # 目标股票数量（悔棋局联想需要更大覆盖）
# 起始锚定 2024-01-01：覆盖原游戏全年数据，并满足 hindsight 所需的 2024→最新区间。
# 结束日期取 Asia/Shanghai 的“今天”，不硬编码年份；非交易日由数据源自然剔除。
# 整包 JS 会被前端一次性加载；1000 只约 ~55–60MB / gzip ~12MB。
START_DATE = "20240101"
SHANGHAI = timezone(timedelta(hours=8))
END_DATE = datetime.now(SHANGHAI).strftime("%Y%m%d")
OUTPUT_DIR = "data"  # 输出目录
OUTPUT_FILE = "stocks_data.json"  # 输出文件名

# 预定义的龙头股列表（沪深300成分股中的代表性股票）
# 如果自动获取失败，使用此列表
FALLBACK_STOCKS = [
    # 金融
    ("600036", "招商银行"), ("601166", "兴业银行"), ("600016", "民生银行"),
    ("601398", "工商银行"), ("601939", "建设银行"), ("601288", "农业银行"),
    ("600000", "浦发银行"), ("601328", "交通银行"), ("002142", "宁波银行"),
    ("600030", "中信证券"), ("601688", "华泰证券"), ("600837", "海通证券"),
    ("601318", "中国平安"), ("601628", "中国人寿"), ("601601", "中国太保"),
    # 消费
    ("600519", "贵州茅台"), ("000858", "五粮液"), ("000568", "泸州老窖"),
    ("002304", "洋河股份"), ("600809", "山西汾酒"), ("000799", "酒鬼酒"),
    ("000596", "古井贡酒"), ("603369", "今世缘"), ("600779", "水井坊"),
    ("000651", "格力电器"), ("000333", "美的集团"), ("002508", "老板电器"),
    ("600690", "海尔智家"), ("002032", "苏泊尔"), ("603486", "科沃斯"),
    ("600887", "伊利股份"), ("600597", "光明乳业"), ("002329", "皇氏集团"),
    ("603288", "海天味业"), ("002557", "洽洽食品"), ("603027", "千禾味业"),
    ("000895", "双汇发展"), ("002311", "海大集团"), ("600298", "安琪酵母"),
    # 医药
    ("600276", "恒瑞医药"), ("000538", "云南白药"), ("600196", "复星医药"),
    ("002007", "华兰生物"), ("300760", "迈瑞医疗"), ("300122", "智飞生物"),
    ("600763", "通策医疗"), ("300347", "泰格医药"), ("603259", "药明康德"),
    ("000963", "华东医药"), ("600867", "通化东宝"), ("002001", "新和成"),
    # 科技/电子
    ("002415", "海康威视"), ("000725", "京东方A"), ("002475", "立讯精密"),
    ("600584", "长电科技"), ("002371", "北方华创"), ("603501", "韦尔股份"),
    ("688981", "中芯国际"), ("002916", "深南电路"), ("300782", "卓胜微"),
    ("600183", "生益科技"), ("002049", "紫光国微"), ("688012", "中微公司"),
    # 新能源/电力设备
    ("300750", "宁德时代"), ("002594", "比亚迪"), ("601012", "隆基绿能"),
    ("002129", "中环股份"), ("600438", "通威股份"), ("002459", "晶澳科技"),
    ("300274", "阳光电源"), ("601877", "正泰电器"), ("300751", "迈为股份"),
    ("002709", "天赐材料"), ("300014", "亿纬锂能"), ("002812", "恩捷股份"),
    # 汽车
    ("600104", "上汽集团"), ("000625", "长安汽车"), ("601238", "广汽集团"),
    ("600741", "华域汽车"), ("002920", "德赛西威"), ("600660", "福耀玻璃"),
    ("601799", "星宇股份"), ("002607", "中公教育"), ("603596", "伯特利"),
    # 地产/建材
    ("000002", "万科A"), ("001979", "招商蛇口"), ("600048", "保利发展"),
    ("600383", "金地集团"), ("000671", "阳光城"), ("600340", "华夏幸福"),
    ("600801", "华新水泥"), ("600585", "海螺水泥"), ("000786", "北新建材"),
    ("002271", "东方雨虹"), ("603816", "顾家家居"), ("603833", "欧派家居"),
    # 机械/军工
    ("600031", "三一重工"), ("000157", "中联重科"), ("002008", "大族激光"),
    ("300124", "汇川技术"), ("601100", "恒立液压"), ("603899", "晨光股份"),
    ("600760", "中航沈飞"), ("600893", "航发动力"), ("002179", "中航光电"),
    ("600150", "中国船舶"), ("601989", "中国重工"), ("000768", "中航飞机"),
    # 化工
    ("600309", "万华化学"), ("002493", "荣盛石化"), ("000830", "鲁西化工"),
    ("600426", "华鲁恒升"), ("002648", "卫星石化"), ("603260", "合盛硅业"),
    ("601216", "君正集团"), ("000703", "恒逸石化"), ("600352", "浙江龙盛"),
    # 钢铁/有色
    ("600019", "宝钢股份"), ("000898", "鞍钢股份"), ("600782", "新钢股份"),
    ("601899", "紫金矿业"), ("600362", "江西铜业"), ("603993", "洛阳钼业"),
    ("000878", "云南铜业"), ("002466", "天齐锂业"), ("002460", "赣锋锂业"),
    ("600547", "山东黄金"), ("600489", "中金黄金"), ("000603", "盛达资源"),
    # 交通运输
    ("601111", "中国国航"), ("600029", "南方航空"), ("600115", "东方航空"),
    ("601006", "大秦铁路"), ("600026", "中远海能"), ("601866", "中远海发"),
    ("600009", "上海机场"), ("000089", "深圳机场"), ("600897", "厦门空港"),
    # 公用事业
    ("600900", "长江电力"), ("600025", "华能水电"), ("003816", "中国广核"),
    ("600886", "国投电力"), ("600795", "国电电力"), ("000027", "深圳能源"),
    # 通信
    ("600050", "中国联通"), ("601728", "中国电信"), ("000063", "中兴通讯"),
    ("600498", "烽火通信"), ("002049", "紫光国微"), ("300628", "亿联网络"),
    # 传媒/互联网
    ("002027", "分众传媒"), ("300413", "芒果超媒"), ("603444", "吉比特"),
    ("002602", "世纪华通"), ("002555", "三七互娱"), ("300418", "昆仑万维"),
    # 食品饮料其他
    ("600132", "重庆啤酒"), ("000729", "燕京啤酒"), ("600600", "青岛啤酒"),
    ("603345", "安井食品"), ("002507", "涪陵榨菜"), ("603517", "绝味食品"),
    # 零售
    ("601933", "永辉超市"), ("002024", "苏宁易购"), ("002251", "步步高"),
    ("600694", "大商股份"), ("600827", "百联股份"), ("002419", "天虹股份"),
    # 农业
    ("002714", "牧原股份"), ("000876", "新希望"), ("002157", "正邦科技"),
    ("600438", "通威股份"), ("002041", "登海种业"), ("600313", "农发种业"),
    # 补充更多以达到200只
    ("601857", "中国石油"), ("600028", "中国石化"), ("601088", "中国神华"),
    ("601225", "陕西煤业"), ("000983", "西山煤电"), ("600188", "兖矿能源"),
    ("600011", "华能国际"), ("600027", "华电国际"), ("001289", "龙源电力"),
    ("601985", "中国核电"), ("600023", "浙能电力"), ("600578", "京能电力"),
    ("601669", "中国电建"), ("601668", "中国建筑"), ("601186", "中国铁建"),
    ("601390", "中国中铁"), ("601800", "中国交建"), ("601618", "中国中冶"),
    ("600060", "海信视像"), ("000100", "TCL科技"), ("600718", "东软集团"),
    ("002410", "广联达"), ("600588", "用友网络"), ("000977", "浪潮信息"),
    ("000661", "长春高新"), ("300015", "爱尔眼科"), ("600085", "同仁堂"),
    ("300529", "健帆生物"), ("603882", "金域医学"), ("688180", "君实生物"),
]


def name_to_pinyin(name):
    """全拼 + 简拼（小写、无音调）。无 pypinyin 时退回空串。"""
    if not name:
        return '', ''
    if lazy_pinyin is None:
        return '', ''
    parts = lazy_pinyin(str(name), style=Style.NORMAL, errors='ignore')
    parts = [p.lower() for p in parts if p]
    full = ''.join(parts)
    initials = ''.join(p[0] for p in parts if p)
    return full, initials


def get_top_stocks_by_market_cap(count=1000):
    """按指数成分覆盖选取前 N 只：沪深300 → 中证500 → 中证1000。"""
    print(f"正在获取最多 {count} 只指数成分股...")

    try:
        frames = []
        for sym, label in [
            ("000300", "沪深300"),
            ("000905", "中证500"),
            ("000852", "中证1000"),
        ]:
            df = ak.index_stock_cons(symbol=sym)
            print(f"获取到{label}成分股 {len(df)} 只")
            frames.append(df)

        result = []
        seen_codes = set()
        for df in frames:
            for _, row in df.iterrows():
                code = str(row['品种代码']).zfill(6)
                if code not in seen_codes and len(result) < count:
                    seen_codes.add(code)
                    result.append({
                        'code': code,
                        'name': row['品种名称']
                    })

        print(f"已选取 {len(result)} 只股票")
        return result

    except Exception as e:
        print(f"获取指数成分股失败: {e}")
        print("使用备用股票列表...")
        return [{'code': code, 'name': name} for code, name in FALLBACK_STOCKS[:count]]


def to_sina_symbol(stock_code):
    """将 6 位代码转为新浪行情代码。"""
    code = str(stock_code).zfill(6)
    if code.startswith(("6", "9")):
        return f"sh{code}"
    if code.startswith(("0", "2", "3")):
        return f"sz{code}"
    if code.startswith(("4", "8")):
        return f"bj{code}"
    return f"sz{code}"


def _row_date_str(date_val):
    if hasattr(date_val, "strftime"):
        return date_val.strftime("%Y-%m-%d")
    return str(date_val)[:10]


def fetch_stock_kline(stock_code, stock_name, start_date, end_date, retries=3):
    """获取单只股票的K线数据。

    本环境访问东方财富 push2his 会被远端断开，因此主路径改用新浪
    ak.stock_zh_a_daily（前复权）。成交量除以 100，与原东方财富“手”口径一致。
    """
    last_err = None
    df = None
    for attempt in range(1, retries + 1):
        try:
            df = ak.stock_zh_a_daily(
                symbol=to_sina_symbol(stock_code),
                start_date=start_date,
                end_date=end_date,
                adjust="qfq",
            )
            last_err = None
            break
        except Exception as e:
            last_err = e
            time.sleep(0.8 * attempt)

    if last_err is not None:
        # 东方财富作兜底（多数机房 IP 会被断开，成功则更好）
        try:
            df = ak.stock_zh_a_hist(
                symbol=stock_code,
                period="daily",
                start_date=start_date,
                end_date=end_date,
                adjust="qfq",
            )
            if df is not None and len(df) > 0:
                kline_data = []
                for _, row in df.iterrows():
                    kline_data.append({
                        "date": _row_date_str(row["日期"]),
                        "open": float(row["开盘"]),
                        "close": float(row["收盘"]),
                        "high": float(row["最高"]),
                        "low": float(row["最低"]),
                        "volume": float(row["成交量"]),
                    })
                print(f"  {stock_code} {stock_name}: {len(kline_data)} 条数据 (em)")
                return kline_data
        except Exception as e:
            last_err = e
        print(f"  {stock_code} {stock_name}: 获取失败 - {last_err}")
        return None

    if df is None or len(df) == 0:
        print(f"  {stock_code} {stock_name}: 无数据")
        return None

    kline_data = []
    for _, row in df.iterrows():
        kline_data.append({
            "date": _row_date_str(row["date"]),
            "open": float(row["open"]),
            "close": float(row["close"]),
            "high": float(row["high"]),
            "low": float(row["low"]),
            # 新浪 volume 为股；除以 100 得到“手”，与原脚本东方财富口径一致
            "volume": float(row["volume"]) / 100.0,
        })

    print(f"  {stock_code} {stock_name}: {len(kline_data)} 条数据")
    return kline_data


def main():
    """主函数"""
    print("=" * 50)
    print("股票数据抓取脚本")
    print("=" * 50)

    # 创建输出目录
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    # 获取股票列表
    stocks = get_top_stocks_by_market_cap(TARGET_STOCK_COUNT)
    if not stocks:
        print("获取股票列表失败，退出")
        return

    # 设置日期范围：2024-01-01 → 今天（Asia/Shanghai）；股票池约 1000 只
    start_date = START_DATE
    end_date = END_DATE
    print(f"\n数据时间范围: {start_date} - {end_date} (end = today Asia/Shanghai)")

    # 抓取K线数据
    print("\n开始抓取K线数据...")
    all_data = []
    success_count = 0

    for i, stock in enumerate(stocks):
        print(f"[{i+1}/{len(stocks)}] ", end="")

        kline = fetch_stock_kline(
            stock['code'],
            stock['name'],
            start_date,
            end_date
        )

        if kline and len(kline) >= 31:  # 至少需要31个交易日
            py, jp = name_to_pinyin(stock['name'])
            all_data.append({
                'code': stock['code'],
                'name': stock['name'],
                'py': py,
                'jp': jp,
                'kline': kline
            })
            success_count += 1

        # 避免请求过快
        time.sleep(0.3)

    print(f"\n成功抓取 {success_count} 只股票的数据")

    # 保存数据
    output_path = os.path.join(OUTPUT_DIR, OUTPUT_FILE)
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(all_data, f, ensure_ascii=False, indent=2)

    # 同时生成 JS 文件供 index.html 直接引用
    js_path = os.path.join(OUTPUT_DIR, "stocks_data.js")
    with open(js_path, 'w', encoding='utf-8') as f:
        f.write("const STOCKS_DATA = ")
        json.dump(all_data, f, ensure_ascii=False, separators=(',', ':'))
        f.write(";")

    print(f"数据已保存至: {output_path}")
    print(f"JS文件已保存至: {js_path}")
    print(f"文件大小: {os.path.getsize(output_path) / 1024 / 1024:.2f} MB")

    # 统计信息
    total_klines = sum(len(s['kline']) for s in all_data)
    print(f"总K线条数: {total_klines}")


if __name__ == "__main__":
    main()
