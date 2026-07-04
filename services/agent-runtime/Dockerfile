FROM gradle:8.10.2-jdk17-alpine AS build
WORKDIR /workspace
COPY services/agent-runtime ./
RUN gradle bootJar --no-daemon

FROM eclipse-temurin:17-jre-alpine
WORKDIR /app
COPY --from=build /workspace/build/libs/*.jar /app/agent-runtime.jar
EXPOSE 8081
CMD ["java", "-jar", "/app/agent-runtime.jar"]

