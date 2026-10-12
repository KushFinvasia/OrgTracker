from fastapi import APIRouter

from app.api.routes import admin, auth, home, people, performance, projects, reports, rewards, rules, tasks, training, workflows

api_router = APIRouter(prefix="/api")
api_router.include_router(auth.router)
api_router.include_router(home.router)
api_router.include_router(people.router)
api_router.include_router(projects.router)
api_router.include_router(projects.requests_router)
api_router.include_router(projects.incidents_router)
api_router.include_router(tasks.router)
api_router.include_router(tasks.validations_router)
api_router.include_router(training.router)
api_router.include_router(performance.router)
api_router.include_router(rewards.router)
api_router.include_router(reports.router)
api_router.include_router(admin.router)
api_router.include_router(rules.router)
api_router.include_router(workflows.router)
