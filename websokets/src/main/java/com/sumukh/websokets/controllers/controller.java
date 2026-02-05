package com.sumukh.websokets.controllers;

import org.springframework.messaging.handler.annotation.DestinationVariable;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.handler.annotation.Payload;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Controller;
import org.springframework.beans.factory.annotation.Autowired;
import java.util.Map;

@Controller
public class controller {

    @Autowired
    private SimpMessagingTemplate template;

    @MessageMapping("/rooms/{roomId}/{event}")
    public void handleRoomEvent(@DestinationVariable String roomId, @DestinationVariable String event, @Payload Map<String, Object> payload) {
        // Broadcasts to /topic/rooms/{roomId}/{event}
        // Example: /topic/rooms/123/line-created
        template.convertAndSend("/topic/rooms/" + roomId + "/" + event, (Object) payload);
    }
}
