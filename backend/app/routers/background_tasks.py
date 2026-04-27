from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import CurrentUser
from app.models import BackgroundTask, Novel, User
from app.schemas.background_task import (
    BackgroundTaskOut,
    CreateBatchTaskIn,
    CreateSingleTaskIn,
    TaskStatusUpdate,
)
from app.services.task_manager import (
    start_batch_chapters_task,
    start_single_chapter_task,
    task_manager,
)

router = APIRouter(prefix="/background-tasks", tags=["background-tasks"])


@router.get("", response_model=list[BackgroundTaskOut])
def list_tasks(
    user: CurrentUser,
    db: Session = Depends(get_db),
    novel_id: int | None = Query(None, description="按作品筛选"),
    status: str | None = Query(None, description="按状态筛选"),
    limit: int = Query(20, ge=1, le=100, description="返回数量限制"),
    offset: int = Query(0, ge=0, description="偏移量"),
) -> list[BackgroundTask]:
    """获取后台任务列表"""
    query = db.query(BackgroundTask).filter(BackgroundTask.user_id == user.id)
    
    if novel_id is not None:
        query = query.filter(BackgroundTask.novel_id == novel_id)
    if status is not None:
        query = query.filter(BackgroundTask.status == status)
    
    tasks = query.order_by(BackgroundTask.created_at.desc()).offset(offset).limit(limit).all()
    return tasks


@router.get("/{task_id}", response_model=BackgroundTaskOut)
def get_task(
    task_id: int,
    user: CurrentUser,
    db: Session = Depends(get_db),
) -> BackgroundTask:
    """获取单个任务详情"""
    task = db.query(BackgroundTask).filter(
        BackgroundTask.id == task_id,
        BackgroundTask.user_id == user.id,
    ).first()
    
    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="任务不存在",
        )
    
    return task


@router.post("/single", response_model=BackgroundTaskOut, status_code=status.HTTP_201_CREATED)
def create_single_task(
    body: CreateSingleTaskIn,
    user: CurrentUser,
    db: Session = Depends(get_db),
) -> BackgroundTask:
    """创建单章节后台生成任务"""
    novel = db.query(Novel).filter(
        Novel.id == body.novel_id,
        Novel.user_id == user.id,
    ).first()
    
    if not novel:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="作品不存在",
        )
    
    task = start_single_chapter_task(
        db,
        user_id=user.id,
        novel_id=body.novel_id,
        chapter_id=body.chapter_id,
        title=body.title,
        summary=body.summary,
        fixed_title=body.fixed_title,
        word_count=body.word_count,
        agent_mode=user.agent_mode,
        max_iterations=user.max_llm_iterations,
    )
    
    db.refresh(task)
    return task


@router.post("/batch", response_model=BackgroundTaskOut, status_code=status.HTTP_201_CREATED)
def create_batch_task(
    body: CreateBatchTaskIn,
    user: CurrentUser,
    db: Session = Depends(get_db),
) -> BackgroundTask:
    """创建批量章节后台生成任务"""
    novel = db.query(Novel).filter(
        Novel.id == body.novel_id,
        Novel.user_id == user.id,
    ).first()
    
    if not novel:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="作品不存在",
        )
    
    if body.chapter_count < 1 or body.chapter_count > 20:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="批量章节数必须在 1-20 之间",
        )
    
    task = start_batch_chapters_task(
        db,
        user_id=user.id,
        novel_id=body.novel_id,
        after_chapter_id=body.after_chapter_id,
        total_summary=body.total_summary,
        chapter_count=body.chapter_count,
        word_count=body.word_count,
        agent_mode=user.agent_mode,
        max_iterations=user.max_llm_iterations,
    )
    
    db.refresh(task)
    return task


@router.post("/{task_id}/cancel", response_model=BackgroundTaskOut)
def cancel_task(
    task_id: int,
    user: CurrentUser,
    db: Session = Depends(get_db),
) -> BackgroundTask:
    """取消后台任务"""
    task = db.query(BackgroundTask).filter(
        BackgroundTask.id == task_id,
        BackgroundTask.user_id == user.id,
    ).first()
    
    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="任务不存在",
        )
    
    if task.status not in ("pending", "running"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="只能取消进行中的任务",
        )
    
    if task_manager.is_running(task_id):
        task_manager.cancel_task(task_id)
    
    task.status = "cancelled"
    db.commit()
    db.refresh(task)
    
    return task


@router.delete("/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_task(
    task_id: int,
    user: CurrentUser,
    db: Session = Depends(get_db),
) -> None:
    """删除后台任务"""
    task = db.query(BackgroundTask).filter(
        BackgroundTask.id == task_id,
        BackgroundTask.user_id == user.id,
    ).first()
    
    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="任务不存在",
        )
    
    if task.status == "running":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="不能删除正在运行的任务，请先取消",
        )
    
    db.delete(task)
    db.commit()


@router.get("/{task_id}/progress")
def get_task_progress(
    task_id: int,
    user: CurrentUser,
    db: Session = Depends(get_db),
) -> dict:
    """获取任务进度（用于轮询）"""
    task = db.query(BackgroundTask).filter(
        BackgroundTask.id == task_id,
        BackgroundTask.user_id == user.id,
    ).first()
    
    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="任务不存在",
        )
    
    progress = 0
    if task.batch_count > 0:
        progress = (task.completed_count / task.batch_count) * 100
    
    return {
        "task_id": task.id,
        "status": task.status,
        "progress": round(progress, 1),
        "current_index": task.current_index,
        "completed_count": task.completed_count,
        "batch_count": task.batch_count,
        "progress_message": task.progress_message,
        "error_message": task.error_message,
        "total_tokens": task.total_tokens,
        "started_at": task.started_at,
        "completed_at": task.completed_at,
    }
