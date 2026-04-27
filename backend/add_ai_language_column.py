"""数据库迁移脚本：添加 users.ai_language 列"""

import sqlite3
import os

def add_ai_language_column():
    db_path = os.path.join(os.path.dirname(__file__), "inkmind.db")
    
    if not os.path.exists(db_path):
        print(f"数据库文件不存在: {db_path}")
        return
    
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    try:
        cursor.execute("PRAGMA table_info(users)")
        columns = cursor.fetchall()
        column_names = [col[1] for col in columns]
        
        if "ai_language" in column_names:
            print("列 users.ai_language 已存在，无需迁移")
            return
        
        print("正在添加 users.ai_language 列...")
        cursor.execute("ALTER TABLE users ADD COLUMN ai_language VARCHAR(8)")
        conn.commit()
        print("迁移完成！")
        
    except sqlite3.OperationalError as e:
        print(f"操作错误: {e}")
    except Exception as e:
        print(f"错误: {e}")
    finally:
        conn.close()

if __name__ == "__main__":
    add_ai_language_column()
