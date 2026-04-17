import asyncio
import aiosqlite

async def clear_db():
    try:
        db = await aiosqlite.connect("guardian.db")
        await db.execute("DELETE FROM claims")
        await db.execute("DELETE FROM policies")
        await db.execute("DELETE FROM users")
        await db.execute("DELETE FROM triggers")
        await db.commit()
        await db.close()
        print("Database cleared successfully")
    except Exception as e:
        print("Error clearing DB: ", e)

asyncio.run(clear_db())
