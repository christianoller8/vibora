package com.vibora.config;

import com.vibora.notificacion.NotificacionRetencionProperties;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;

/**
 * Activa @Scheduled. Cada tarea indica su planificador (el del WebSocket: ver WebSocketConfig) o usa el local por
 * defecto (purga de notificaciones: una vez al dia).
 */
@Configuration
@EnableScheduling
@EnableConfigurationProperties({ NotificacionRetencionProperties.class, com.vibora.personal.InvitacionProperties.class,
		com.vibora.auth.SesionProperties.class })
public class SchedulingConfig {
}
